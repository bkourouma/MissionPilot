import Link from "next/link";
import { BadgeStatut } from "../ui/BadgeStatut";
import { formaterDateHeure } from "../../lib/format";
import { DECISIONS, hrefPreuve, libelleAuteur, type PreuveLiee } from "../../lib/preuves";
import { EtiquettesPreuve, ExtraitPreuve } from "./AffichagePreuves";
import { BoutonDelier, FormulaireArbitrage } from "./ActionsLiens";

export interface PreuveLieeCarteProps {
  missionId: string;
  assertionId: string;
  preuve: PreuveLiee;
  /** Droit d'écriture : retrait du lien et arbitrage. */
  ecrire: boolean;
  /** Propose le retrait du lien (écran de l'assertion seulement). */
  retrait?: boolean;
}

/** Une preuve liée à une assertion : source, extrait, état de l'arbitrage et actions. */
export function PreuveLieeCarte({
  missionId,
  assertionId,
  preuve,
  ecrire,
  retrait = true,
}: PreuveLieeCarteProps) {
  return (
    <li className="mp-preuve-ligne">
      <h4 className="mp-preuve-ligne__titre">
        <Link href={hrefPreuve(missionId, preuve.id)}>{preuve.source_precise}</Link>
      </h4>
      <EtiquettesPreuve preuve={preuve} />
      <p className="mp-texte-doux mp-texte-petit">
        {`Version ${preuve.version} · recueillie par ${libelleAuteur(preuve.auteur)}`}
      </p>
      <ExtraitPreuve preuve={preuve} />
      {preuve.sens === "contre" ? (
        preuve.a_arbitrer ? (
          <div className="mp-pile">
            <BadgeStatut tonalite="danger">Contradiction à arbitrer</BadgeStatut>
            {ecrire ? (
              <FormulaireArbitrage assertionId={assertionId} preuveId={preuve.id} />
            ) : (
              <p className="mp-texte-doux">Un consultant de la mission doit arbitrer.</p>
            )}
          </div>
        ) : preuve.arbitrage ? (
          <div className="mp-pile">
            <BadgeStatut tonalite="succes">Arbitrée</BadgeStatut>
            <p className="mp-texte-petit">
              {DECISIONS[preuve.arbitrage.decision]} · {libelleAuteur(preuve.arbitrage.arbitre)} ·{" "}
              {formaterDateHeure(preuve.arbitrage.arbitre_le)}
            </p>
            <p className="mp-texte-petit">{preuve.arbitrage.motif}</p>
          </div>
        ) : null
      ) : null}
      {ecrire && retrait ? (
        <BoutonDelier assertionId={assertionId} preuveId={preuve.id} sens={preuve.sens} />
      ) : null}
    </li>
  );
}
