import type { ValidationVersion } from "../../lib/methodes";
import {
  grouperAnomalies,
  libelleAnomalie,
  nombreErreursBloquantes,
  textePastille,
  texteBlocage,
  tonalitePastille,
} from "../../lib/methodes-coherence";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";

/**
 * Contrôle de cohérence d'une version (STD-11) en langage d'expert : une pastille par catégorie
 * (erreurs, avertissements ou « conforme »), puis les anomalies de chaque catégorie avec ce
 * qu'elles changent à la publication. Le chemin technique reste en second plan.
 */
export function ControleCoherence({ validation }: { validation: ValidationVersion }) {
  const groupes = grouperAnomalies(validation);
  const bloquantes = nombreErreursBloquantes(validation);
  const cas = validation.cas_types;
  return (
    <div className="mp-pile">
      {bloquantes === 0 ? (
        <Alerte tonalite="succes" annonce="aucune">
          <p>
            Version cohérente : elle peut être publiée.
            {validation.anomalies.length > 0
              ? " Les avertissements ci-dessous n'empêchent pas la publication."
              : ""}
          </p>
        </Alerte>
      ) : (
        <Alerte tonalite="danger" annonce="aucune" titre="Version incohérente">
          <p>
            {bloquantes === 1
              ? "Une erreur bloque la publication : corrigez-la avant de publier."
              : `${bloquantes} erreurs bloquent la publication : corrigez-les avant de publier.`}
          </p>
        </Alerte>
      )}
      {cas ? (
        <p>
          Cas types : {cas.reussis} réussi(s), {cas.echoues} échoué(s).
        </p>
      ) : null}

      <ul className="mp-methode__pastilles" aria-label="Synthèse par catégorie">
        {groupes.map((g) => (
          <li key={g.categorie}>
            <BadgeStatut tonalite={tonalitePastille(g)}>
              {g.libelle} : {textePastille(g)}
            </BadgeStatut>
          </li>
        ))}
      </ul>

      {groupes
        .filter((g) => g.anomalies.length > 0)
        .map((g) => (
          <section
            key={g.categorie}
            className="mp-methode__etape"
            aria-labelledby={`coherence-${g.categorie}`}
          >
            <h3 id={`coherence-${g.categorie}`} className="mp-section__titre">
              {g.libelle}
            </h3>
            <p className="mp-texte-doux mp-texte-petit">{g.consigne}</p>
            <ul className="mp-liste-simple">
              {g.anomalies.map((a, i) => (
                <li key={`${a.code}-${a.chemin}-${i}`} className="mp-methode__regle">
                  <span>
                    <BadgeStatut tonalite={a.gravite === "erreur" ? "danger" : "attention"}>
                      {a.gravite === "erreur" ? "Erreur" : "Avertissement"}
                    </BadgeStatut>{" "}
                    <strong>{libelleAnomalie(a.code)}</strong>
                  </span>
                  <span>{a.message}</span>
                  <span className="mp-texte-petit">
                    {texteBlocage(a)}
                    {a.regle ? ` · règle « ${a.regle} »` : ""}
                  </span>
                  <span className="mp-methode__code mp-texte-doux">{a.chemin}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
