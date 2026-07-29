'use strict';

const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const { handler } = require('./index');

const originalFetch = global.fetch;
const originalEndpoint = process.env.MINI_HAS_ALEXA_ENDPOINT;

afterEach(() => {
    global.fetch = originalFetch;
    if (originalEndpoint === undefined) delete process.env.MINI_HAS_ALEXA_ENDPOINT;
    else process.env.MINI_HAS_ALEXA_ENDPOINT = originalEndpoint;
});

test('forwards the account-linked token without logging or changing the directive', async () => {
    process.env.MINI_HAS_ALEXA_ENDPOINT = 'https://mini-has.example/alexa/smarthome';
    const event = discoveryEvent('oauth-access-token');
    let captured;
    global.fetch = async (url, options) => {
        captured = { url, options };
        return new Response(JSON.stringify({
            event: {
                header: {
                    namespace: 'Alexa.Discovery',
                    name: 'Discover.Response',
                    messageId: 'response-id',
                    payloadVersion: '3',
                },
                payload: { endpoints: [] },
            },
        }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    };

    const response = await handler(event);

    assert.equal(captured.url, 'https://mini-has.example/alexa/smarthome');
    assert.equal(captured.options.headers.Authorization, 'Bearer oauth-access-token');
    assert.deepEqual(JSON.parse(captured.options.body), event);
    assert.equal(response.event.header.name, 'Discover.Response');
});

test('rejects a directive without an account-linked token', async () => {
    let called = false;
    global.fetch = async () => {
        called = true;
        throw new Error('must not be called');
    };

    const response = await handler(discoveryEvent(''));

    assert.equal(called, false);
    assert.equal(response.event.header.name, 'ErrorResponse');
    assert.equal(response.event.payload.type, 'INVALID_AUTHORIZATION_CREDENTIAL');
});

test('converts an unavailable backend into a safe Alexa error', async () => {
    process.env.MINI_HAS_ALEXA_ENDPOINT = 'https://mini-has.example/alexa/smarthome';
    global.fetch = async () => new Response('upstream details must not leak', {
        status: 502,
    });

    const response = await handler(discoveryEvent('oauth-access-token'));

    assert.equal(response.event.payload.type, 'ENDPOINT_UNREACHABLE');
    assert.equal(
        JSON.stringify(response).includes('upstream details'),
        false,
    );
});

function discoveryEvent(token) {
    return {
        directive: {
            header: {
                namespace: 'Alexa.Discovery',
                name: 'Discover',
                messageId: 'request-id',
                payloadVersion: '3',
            },
            payload: {
                scope: {
                    type: 'BearerToken',
                    token,
                },
            },
        },
    };
}
