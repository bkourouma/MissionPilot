import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { Alerte } from "../ui/Alerte";
import { Tableau } from "../ui/Tableau";
import { libelleDevise } from "../../lib/format";
import { obtenirLangue } from "../../lib/i18n/serveur";
import {
  AVERTISSEMENT_GROUPE,
  AVERTISSEMENT_GROUPE_EN,
  formaterFiabiliteGroupe,
  formaterPart,
  libelleControle,
  libelleMotifExclusion,
  libelleNoeud,
  lignesIndicateurs,
  type GroupeApi,
  type IndicateursConsolides,
  type LigneIndicateur,
} from "../../lib/dossier-groupes";
import "./groupe.css";
import type { Langue } from "@missionpilot/shared";

function TableauIndicateurs({
  legende,
  valeurs,
  groupe,
  langue,
}: {
  legende: string;
  valeurs: IndicateursConsolides;
  groupe: GroupeApi;
  langue: Langue;
}) {
  const lignes = lignesIndicateurs(
    valeurs,
    groupe.consolidation.devise,
    groupe.indicateurs,
    langue,
  );
  return (
    <Tableau<LigneIndicateur>
      legende={legende}
      legendeVisible
      lignes={lignes}
      cleLigne={(l) => l.cle}
      colonnes={[
        {
          cle: "libelle",
          entete: langue === "en" ? "Indicator" : "Indicateur",
          rendu: (l) => l.libelle,
        },
        {
          cle: "valeur",
          entete: langue === "en" ? "Value" : "Valeur",
          alignement: "droite",
          rendu: (l) => l.valeur,
        },
      ]}
    />
  );
}

/**
 * Consolidation simple du groupe (DOS-05) : deux lectures (intégrale et proportionnelle), le
 * périmètre et ses exclusions. Tous les chiffres viennent du moteur par l'API ; la devise du
 * groupe est celle de la racine ; les entités XOF, XAF ou EUR sont converties par le moteur à la parité
 * fixe, l'USD (sans taux validé) est exclu.
 */
export async function ConsolidationGroupe({ groupe }: { groupe: GroupeApi }) {
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  const c = groupe.consolidation;
  return (
    <section aria-labelledby="titre-consolidation" className="mp-groupe">
      <h2 id="titre-consolidation" className="mp-carte__titre">
        {t("Consolidation simple", "Simple consolidation")}
        {c.exercice !== null ? ` · ${t("exercice", "fiscal year")} ${c.exercice}` : ""}
        {c.devise ? ` · ${libelleDevise(c.devise)}` : ""}{" "}
        {c.partielle ? (
          <BadgeStatut tonalite="attention">
            {t("Consolidation partielle", "Partial consolidation")}
          </BadgeStatut>
        ) : null}
      </h2>

      <Alerte
        tonalite="attention"
        annonce="aucune"
        titre={langue === "en" ? AVERTISSEMENT_GROUPE_EN : AVERTISSEMENT_GROUPE}
      >
        <ul className="mp-groupe-regles">
          {groupe.regles.textes.map((texte) => (
            <li key={texte}>{texte}</li>
          ))}
        </ul>
      </Alerte>

      {c.partielle ? (
        <Alerte tonalite="attention" annonce="aucune">
          <p>
            {t(
              "Au moins une entité du groupe est exclue du calcul : les totaux ci-dessous sous-estiment le groupe. Le détail figure dans le périmètre.",
              "At least one group entity is excluded from the calculation: the totals below understate the group. Details are in the scope.",
            )}
          </p>
        </Alerte>
      ) : null}

      <div className="mp-groupe-consolidation">
        <Carte titre={t("Consolidation intégrale", "Full consolidation")} niveauTitre={3}>
          <TableauIndicateurs
            legende={t(
              "Consolidation intégrale (entités contrôlées à 100 %)",
              "Full consolidation (entities controlled at 100%)",
            )}
            valeurs={c.integrale}
            groupe={groupe}
            langue={langue}
          />
        </Carte>
        <Carte
          titre={t("Consolidation proportionnelle", "Proportional consolidation")}
          niveauTitre={3}
        >
          <TableauIndicateurs
            legende={t(
              "Consolidation proportionnelle (pondérée par la part détenue)",
              "Proportional consolidation (weighted by the share held)",
            )}
            valeurs={c.proportionnelle}
            groupe={groupe}
            langue={langue}
          />
        </Carte>
      </div>

      <Carte titre={t("Périmètre", "Scope")} niveauTitre={3}>
        <p>
          {t(
            "Fiabilité moyenne pondérée par la part cumulée :",
            "Average reliability weighted by cumulative share:",
          )}{" "}
          <strong>{formaterFiabiliteGroupe(c.fiabilite.moyenne_ponderee, langue)}</strong>
        </p>
        <h4>{t("Entités incluses", "Included entities")}</h4>
        {c.perimetre.inclus.length === 0 ? (
          <p>{t("Aucune entité incluse.", "No entities included.")}</p>
        ) : (
          <ul className="mp-groupe-perimetre">
            {c.perimetre.inclus.map((e) => (
              <li key={e.id}>
                <strong>{e.nom}</strong> — {t("part cumulée", "cumulative share")}{" "}
                {formaterPart(e.part_cumulee_bps, langue)} · {libelleControle(e.controlee, langue)}
              </li>
            ))}
          </ul>
        )}
        {(c.conversions ?? []).length > 0 ? (
          <>
            <h4>{t("Entités converties", "Converted entities")}</h4>
            <ul className="mp-groupe-perimetre">
              {(c.conversions ?? []).map((v) => (
                <li key={v.id}>
                  <strong>{v.nom}</strong> —{" "}
                  {t(
                    `convertie de ${v.de} en ${v.vers} (parité fixe)`,
                    `converted from ${v.de} to ${v.vers} (fixed parity)`,
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <h4>{t("Entités exclues", "Excluded entities")}</h4>
        {c.perimetre.exclus.length === 0 ? (
          <p>{t("Aucune entité exclue.", "No entities excluded.")}</p>
        ) : (
          <ul className="mp-groupe-perimetre">
            {c.perimetre.exclus.map((e, i) => (
              <li key={`${e.id ?? "anonyme"}-${i}`}>
                <strong>{libelleNoeud({ visible: Boolean(e.id), nom: e.nom }, langue)}</strong> —{" "}
                {libelleMotifExclusion(e.motif, langue)}
              </li>
            ))}
          </ul>
        )}
      </Carte>
    </section>
  );
}
