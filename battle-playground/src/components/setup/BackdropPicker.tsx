import backdropIndex from "../../assets/backdrops/index.json";

export interface BackdropOption {
  id: string;
  label: string;
}

export const BACKDROPS: BackdropOption[] = backdropIndex as BackdropOption[];

interface Props {
  value: string;
  onChange: (id: string) => void;
}

export function BackdropPicker({ value, onChange }: Props) {
  return (
    <label>
      Backdrop
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {BACKDROPS.map((b) => (
          <option key={b.id} value={b.id}>
            {b.label}
          </option>
        ))}
      </select>
    </label>
  );
}
