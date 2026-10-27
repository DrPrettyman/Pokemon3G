import type { Weather } from "pokedata3g";
import { WEATHER_OPTIONS } from "../../config/setupConfig";

interface Props {
  value: Weather | "clear";
  onChange: (value: Weather | "clear") => void;
}

export function WeatherPicker({ value, onChange }: Props) {
  return (
    <label>
      Weather
      <select value={value} onChange={(e) => onChange(e.target.value as Weather | "clear")}>
        {WEATHER_OPTIONS.map((w) => (
          <option key={w.id} value={w.id}>
            {w.label}
          </option>
        ))}
      </select>
    </label>
  );
}
