import type { ValidationVersion } from "../../lib/methodes";
import {
  grouperAnomalies,
  libelleAnomalie,
  nombreErreursBloquantes,
  textePastille,
  texteBlocage,
  tonalitePastille,
} from "../../lib/methodes-coherence";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";

/**
 * Contrôle de cohérence d'une version (STD-11) en langage d'expert : une pastille par catégorie
 * (erreurs, avertissements ou « conforme »), puis les anomalies de chaque catégorie avec ce
 * qu'elles changent à la publication. Le chemin technique reste en second plan.
 */
export async function ControleCoherence({ validation }: { validation: ValidationVersion }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const groupes = grouperAnomalies(validation, langue);
  const bloquantes = nombreErreursBloquantes(validation);
  const cas = validation.cas_types;
  return (
    <div className="mp-pile">
      {bloquantes === 0 ? (
        <Alerte tonalite="succes" annonce="aucune">
          <p>
            {t(
              "Version cohérente : elle peut être publiée.",
              "Consistent version: it can be published.",
            )}
            {validation.anomalies.length > 0
              ? t(
                  " Les avertissements ci-dessous n'empêchent pas la publication.",
                  " The warnings below do not prevent publication.",
                )
              : ""}
          </p>
        </Alerte>
      ) : (
        <Alerte
          tonalite="danger"
          annonce="aucune"
          titre={t("Version incohérente", "Inconsistent version")}
        >
          <p>
            {bloquantes === 1
              ? t(
                  "Une erreur bloque la publication : corrigez-la avant de publier.",
                  "One error blocks publication: fix it before publishing.",
                )
              : t(
                  `${bloquantes} erreurs bloquent la publication : corrigez-les avant de publier.`,
                  `${bloquantes} errors block publication: fix them before publishing.`,
                )}
          </p>
        </Alerte>
      )}
      {cas ? (
        <p>
          {t(
            `Cas types : ${cas.reussis} réussi(s), ${cas.echoues} échoué(s).`,
            `Test cases: ${cas.reussis} passed, ${cas.echoues} failed.`,
          )}
        </p>
      ) : null}

      <ul
        className="mp-methode__pastilles"
        aria-label={t("Synthèse par catégorie", "Summary by category")}
      >
        {groupes.map((g) => (
          <li key={g.categorie}>
            <BadgeStatut tonalite={tonalitePastille(g)}>
              {g.libelle}
              {t(" : ", ": ")}
              {textePastille(g, langue)}
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
                      {a.gravite === "erreur"
                        ? t("Erreur", "Error")
                        : t("Avertissement", "Warning")}
                    </BadgeStatut>{" "}
                    <strong>{libelleAnomalie(a.code, langue)}</strong>
                  </span>
                  <span>{a.message}</span>
                  <span className="mp-texte-petit">
                    {texteBlocage(a, langue)}
                    {a.regle ? t(` · règle « ${a.regle} »`, ` · rule "${a.regle}"`) : ""}
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
