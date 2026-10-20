import Link from "next/link";
import { grouperSynthese, lienSynthese, phraseCompteur } from "../../lib/portail-canaux";
import type { SyntheseDirigeantApi } from "@missionpilot/shared";
import "./canaux.css";

export interface VueSyntheseProps {
  synthese: Pick<SyntheseDirigeantApi, "points_attention" | "decisions_attendues" | "sections">;
  /** Espace client : les sections mènent à la page concernée ; côté cabinet, elles restent du texte. */
  avecLiens: boolean;
}

/**
 * Synthèse hebdomadaire du dirigeant : deux nombres, puis le détail par section. Mobile d'abord.
 * Jamais un montant : seuls des compteurs et des liens vers l'espace client.
 */
export function VueSynthese({ synthese, avecLiens }: VueSyntheseProps) {
  const groupes = grouperSynthese(synthese);
  return (
    <div className="mp-pile">
      <ul className="mp-canaux__compteurs" aria-label="Résumé de la semaine">
        <li className="mp-canaux__compteur">
          <span className="mp-canaux__compteur-valeur">{synthese.points_attention}</span>
          <span className="mp-canaux__compteur-libelle">
            {synthese.points_attention > 1 ? "points d'attention" : "point d'attention"}
          </span>
        </li>
        <li className="mp-canaux__compteur">
          <span className="mp-canaux__compteur-valeur">{synthese.decisions_attendues}</span>
          <span className="mp-canaux__compteur-libelle">
            {synthese.decisions_attendues > 1 ? "décisions attendues" : "décision attendue"}
          </span>
        </li>
      </ul>
      {groupes.map((g) => (
        <section key={g.groupe} aria-labelledby={`synthese-${g.groupe}`} className="mp-pile">
          <h2 id={`synthese-${g.groupe}`} className="mp-section__titre">
            {`${g.titre} (${phraseCompteur(g.total, g.groupe)})`}
          </h2>
          <ul className="mp-canaux__sections">
            {g.sections.map((s) => {
              const href = avecLiens ? lienSynthese(s.lien) : null;
              return (
                <li key={s.code}>
                  {href ? <Link href={href}>{s.libelle}</Link> : <span>{s.libelle}</span>}
                  <span className="mp-canaux__section-nombre">{s.nombre}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
