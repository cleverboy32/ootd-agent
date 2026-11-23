export type WeatherTemperatureRange = { min: number; max: number };

export type WeatherConditions = {
  temperature?: WeatherTemperatureRange;
  apparentTemperature?: WeatherTemperatureRange;
  windPower?: string;
  humidity?: number;
};

export type WeatherInput = string | { weather: string; weatherConditions?: WeatherConditions };

const NUMBER = String.raw`[+-]?\d+(?:\.\d+)?`;
const CELSIUS = String.raw`(?:℃|°\s*c|(?:摄氏)?度)`;
const INTERVAL = String.raw`(?:[-–—~～至到])`;
const TEMPERATURE = String.raw`(${NUMBER})(?:\s*${CELSIUS}?\s*${INTERVAL}\s*(${NUMBER}))?\s*${CELSIUS}`;
const APPARENT_LABEL = String.raw`(?:体感(?:气温|温度)?|feels\s+like)\s*[:：]?\s*(?:约\s*)?`;
const NON_AMBIENT_LABEL = String.raw`(?:温差|露点(?:温度)?)\s*[:：]?\s*(?:约\s*)?`;

function collectRange(values: number[]): WeatherTemperatureRange | undefined {
  if (values.length === 0) return undefined;
  return { min: Math.min(...values), max: Math.max(...values) };
}

export function readWeatherConditions(input: WeatherInput): WeatherConditions {
  if (typeof input !== 'string' && input.weatherConditions) return input.weatherConditions;
  const text = (typeof input === 'string' ? input : input.weather ?? '').replace(/−/g, '-');
  const apparentValues: number[] = [];
  const ambientText = text.replace(
    new RegExp(APPARENT_LABEL + TEMPERATURE, 'gi'),
    (_match: string, first: string, last?: string) => {
      apparentValues.push(Number(first), Number(last ?? first));
      return ' ';
    }
  ).replace(new RegExp(NON_AMBIENT_LABEL + TEMPERATURE, 'gi'), ' ');
  const ambientValues: number[] = [];
  for (const match of ambientText.matchAll(new RegExp(TEMPERATURE, 'gi'))) {
    ambientValues.push(Number(match[1]), Number(match[2] ?? match[1]));
  }
  const humidity = text.match(/湿度\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/)?.[1];
  return {
    temperature: collectRange(ambientValues),
    apparentTemperature: collectRange(apparentValues),
    windPower: text.match(/风(?:力)?\s*[:：]?\s*([≤<≥>]?\s*\d+(?:\s*[-–—~～至到]\s*\d+)?\s*级)/)?.[1],
    humidity: humidity === undefined ? undefined : Number(humidity),
  };
}

export function selectDressingTemperature(conditions: WeatherConditions): WeatherTemperatureRange | undefined {
  const { temperature, apparentTemperature } = conditions;
  if (temperature && temperature.min !== temperature.max &&
      apparentTemperature && apparentTemperature.min === apparentTemperature.max) {
    return temperature;
  }
  return apparentTemperature ?? temperature;
}

export function getDressingTemperature(input: WeatherInput): WeatherTemperatureRange | undefined {
  return selectDressingTemperature(readWeatherConditions(input));
}

export function formatWeatherRange(range: WeatherTemperatureRange): string {
  return range.min === range.max ? `${range.min}℃` : `${range.min}–${range.max}℃`;
}
