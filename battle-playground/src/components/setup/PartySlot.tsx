import type { Pokemon } from "pokedata3g";
import { spriteUrlFor } from "../../battle/spriteUrl";

interface Props {
  member: Pokemon | null;
  editable: boolean;
  onClick?: () => void;
}

export function PartySlot({ member, editable, onClick }: Props) {
  const handleClick = editable && onClick ? onClick : undefined;
  return (
    <div
      className={`party-slot ${editable ? "editable" : "readonly"}`}
      onClick={handleClick}
    >
      {member ? (
        <>
          <img src={spriteUrlFor(member, "front")} alt={member.name} />
          <div className="name">{member.name}</div>
          <div className="lvl">Lv {member.level}</div>
        </>
      ) : (
        <div className="name">—</div>
      )}
    </div>
  );
}
