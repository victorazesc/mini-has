import { NextResponse } from "next/server";

const DEFAULT_LATITUDE = "-26.72";
const DEFAULT_LONGITUDE = "-48.68";

type OpenMeteoResponse = {
  current?: {
    apparent_temperature?: number;
    is_day?: number;
    temperature_2m?: number;
    time?: string;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  timezone?: string;
};

export async function GET() {
  const params = new URLSearchParams({
    latitude: process.env.WEATHER_LATITUDE ?? DEFAULT_LATITUDE,
    longitude: process.env.WEATHER_LONGITUDE ?? DEFAULT_LONGITUDE,
    current:
      "temperature_2m,apparent_temperature,is_day,weather_code,wind_speed_10m",
    timezone: "auto",
  });

  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
      { next: { revalidate: 600 } },
    );

    if (!response.ok) {
      return NextResponse.json(
        { message: "Falha ao buscar clima." },
        { status: 502 },
      );
    }

    const data = (await response.json()) as OpenMeteoResponse;
    const current = data.current;

    if (
      !current ||
      typeof current.temperature_2m !== "number" ||
      typeof current.weather_code !== "number" ||
      typeof current.is_day !== "number" ||
      !current.time
    ) {
      return NextResponse.json(
        { message: "Resposta de clima invalida." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      temperature: current.temperature_2m,
      apparentTemperature: current.apparent_temperature ?? null,
      weatherCode: current.weather_code,
      isDay: current.is_day === 1,
      windSpeed: current.wind_speed_10m ?? null,
      time: current.time,
      timezone: data.timezone ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        message: "Falha ao buscar clima.",
        error: error instanceof Error ? error.message : "Erro desconhecido.",
      },
      { status: 502 },
    );
  }
}
