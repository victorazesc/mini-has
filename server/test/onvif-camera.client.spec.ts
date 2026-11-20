import assert from 'node:assert/strict';
import test from 'node:test';
import { OnvifCameraClient } from '../src/infrastructure/providers/onvif-camera.client';

type SoapCall = {
  url: string;
  action: string;
  body: string;
  timeoutMs?: number;
};

type TestableOnvifClient = OnvifCameraClient & {
  soapRequest: (
    url: string,
    action: string,
    body: string,
    timeoutMs?: number,
  ) => Promise<string>;
};

function client(): OnvifCameraClient {
  return new OnvifCameraClient('192.168.1.9', 554, 'admin', 'secret');
}

function mockSoap(
  target: OnvifCameraClient,
  handler: (call: SoapCall) => Promise<string>,
): void {
  (target as TestableOnvifClient).soapRequest = (url, action, body, timeoutMs) =>
    handler({ url, action, body, timeoutMs });
}

test('creates a PullPoint subscription using the camera Events service', async () => {
  const target = client();
  const calls: SoapCall[] = [];

  mockSoap(target, async (call) => {
    calls.push(call);

    if (call.action.endsWith('/GetCapabilities')) {
      return '<Capabilities><Events><XAddr>http://192.168.1.9/onvif/events</XAddr></Events></Capabilities>';
    }

    return '<CreatePullPointSubscriptionResponse><SubscriptionReference><Address>http://192.168.1.9/onvif/subscription?Idx=1&amp;Token=abc</Address></SubscriptionReference></CreatePullPointSubscriptionResponse>';
  });

  assert.equal(
    await target.createMotionPullPoint(),
    'http://192.168.1.9/onvif/subscription?Idx=1&Token=abc',
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'http://192.168.1.9/onvif/events');
  assert.equal(
    calls[1].action,
    'http://www.onvif.org/ver10/events/wsdl/EventPortType/CreatePullPointSubscriptionRequest',
  );
  assert.match(calls[1].body, /InitialTerminationTime>PT10M/);
});

test('rejects a PullPoint subscription URL outside the camera host', async () => {
  const target = client();

  mockSoap(target, async (call) => {
    if (call.action.endsWith('/GetCapabilities')) {
      return '<Capabilities><Events><XAddr>http://192.168.1.9/onvif/events</XAddr></Events></Capabilities>';
    }

    return '<SubscriptionReference><Address>http://attacker.invalid/onvif/subscription</Address></SubscriptionReference>';
  });

  await assert.rejects(
    () => target.createMotionPullPoint(),
    /URL externa para assinatura de eventos/,
  );
});

test('pulls only active MotionAlarm or Motion notifications', async () => {
  const target = client();
  const calls: SoapCall[] = [];

  mockSoap(target, async (call) => {
    calls.push(call);

    return `<PullMessagesResponse>
      <NotificationMessage>
        <Topic>tns1:RuleEngine/CellMotionDetector/Motion</Topic>
        <Message UtcTime="2026-07-30T21:49:10Z">
          <Data><SimpleItem Name="State" Value="true"/></Data>
        </Message>
      </NotificationMessage>
      <NotificationMessage>
        <Topic>tns1:VideoSource/MotionAlarm</Topic>
        <Message><Data><SimpleItem Name="IsMotion" Value="1"/></Data></Message>
      </NotificationMessage>
      <NotificationMessage>
        <Topic>tns1:VideoSource/MotionAlarm</Topic>
        <Message><Data><SimpleItem Name="Motion" Value="active"/></Data></Message>
      </NotificationMessage>
      <NotificationMessage>
        <Topic>tns1:VideoSource/MotionAlarm</Topic>
        <Message><Data><SimpleItem Name="State" Value="false"/></Data></Message>
      </NotificationMessage>
      <NotificationMessage>
        <Topic>tns1:RuleEngine/ObjectDetector/Vehicle</Topic>
        <Message><Data><SimpleItem Name="State" Value="true"/></Data></Message>
      </NotificationMessage>
    </PullMessagesResponse>`;
  });

  assert.deepEqual(
    await target.pullMotionEvents('http://192.168.1.9/onvif/subscription'),
    [
      {
        active: true,
        topic: 'tns1:RuleEngine/CellMotionDetector/Motion',
        observedAt: '2026-07-30T21:49:10Z',
      },
      { active: true, topic: 'tns1:VideoSource/MotionAlarm' },
      { active: true, topic: 'tns1:VideoSource/MotionAlarm' },
    ],
  );
  assert.equal(calls[0].timeoutMs, 15_000);
  assert.match(calls[0].body, /Timeout>PT10S/);
  assert.match(calls[0].body, /MessageLimit>20/);
  assert.equal(
    calls[0].action,
    'http://www.onvif.org/ver10/events/wsdl/PullPointSubscription/PullMessagesRequest',
  );
});

test('unsubscribe is best-effort but still rejects an external URL', async () => {
  const target = client();

  mockSoap(target, async () => {
    throw new Error('camera offline');
  });

  await target.unsubscribeMotionPullPoint('http://192.168.1.9/onvif/subscription');
  await assert.rejects(
    () => target.unsubscribeMotionPullPoint('http://attacker.invalid/onvif/subscription'),
    /URL externa para assinatura de eventos/,
  );
});
