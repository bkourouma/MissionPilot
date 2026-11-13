import type { Metadata } from "next";
import { ArbreHypotheses } from "../../../../../../../components/due-diligence/ArbreHypotheses";
import { FormulaireHypothese } from "../../../../../../../components/due-diligence/FormulairesHypothese";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import {
  cheminHypotheses,
  construireArbre,
  droitsDd,
  hrefEcranDossier,
  parentsPossibles,
  type ReponseHypotheses,
} from "../../../../../../../lib/due-diligence";
import { obtenirT } from "../../../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Hypothèses du dossier", "File hypotheses") };
}

/**
 * Arbre d'hypothèses (DD-09, quatre niveaux au plus) : chaque hypothèse est confirmée, infirmée
 * ou non concluante. Le moteur INDIQUE, l'expert DÉCIDE, un tiers VALIDE.
 */
export default async function PageHypothesesDd({
  params,
}: {
  params: Promise<{ id: string; dossierId: string }>;
}) {
  const { id, dossierId } = await params;
  const t = await obtenirT();
  const { utilisateur } = await exigerPermission("dd.lire");
  const mission = await chargerMission(id);
  if (!mission.ok) return null;
  const droits = droitsDd(utilisateur.roles, mission.donnees);
  const r = await chargerServeur<ReponseHypotheses>(cheminHypotheses(dossierId));
  if (!r.ok) {
    return (
      <EtatErreur
        titre={t(
          "Les hypothèses n'ont pas pu être chargées.",
          "The hypotheses could not be loaded.",
        )}
        message={r.message}
        hrefReessayer={hrefEcranDossier(id, dossierId, "hypotheses")}
      />
    );
  }
  const { noeuds, arbre } = r.donnees;
  const parents = parentsPossibles(noeuds).map((n) => ({ valeur: n.id, libelle: n.libelle }));

  return (
    <>
      {arbre.incoherences.length > 0 ? (
        <Alerte
          tonalite="attention"
          titre={t("Incohérences dans l'arbre", "Inconsistencies in the tree")}
          annonce="aucune"
        >
          <p>
            {t(
              `${arbre.incoherences.length} hypothèse(s) ont un verdict contradictoire avec leurs sous-hypothèses (parent confirmé avec un enfant infirmé, ou parent infirmé dont tous les enfants sont confirmés). Revoyez-les avant de soumettre la note.`,
              `${arbre.incoherences.length} hypothesis(es) have a verdict that contradicts their sub-hypotheses (confirmed parent with a refuted child, or refuted parent whose children are all confirmed). Review them before submitting the memo.`,
            )}
          </p>
        </Alerte>
      ) : null}
      <Carte titre={t("Arbre des hypothèses", "Hypothesis tree")} niveauTitre={3}>
        {noeuds.length === 0 ? (
          <EtatVide titre={t("Aucune hypothèse.", "No hypothesis.")} icone="bulle">
            <p>
              {droits.ecrire
                ? t(
                    "Posez les hypothèses à confirmer ou à infirmer : chacune se jugera sur des assertions sourcées.",
                    "Set the hypotheses to confirm or refute: each will be judged on sourced statements.",
                  )
                : t(
                    "Les hypothèses apparaîtront ici dès qu'un consultant les aura posées.",
                    "Hypotheses will appear here as soon as a consultant has set them.",
                  )}
            </p>
          </EtatVide>
        ) : (
          <ArbreHypotheses missionId={id} dossierId={dossierId} arbre={construireArbre(noeuds)} />
        )}
      </Carte>
      {droits.ecrire ? (
        <Carte titre={t("Nouvelle hypothèse", "New hypothesis")} niveauTitre={3}>
          <FormulaireHypothese dossierId={dossierId} parents={parents} />
        </Carte>
      ) : null}
    </>
  );
}
