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
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Hypothèses du dossier" };

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
  const { utilisateur } = await exigerPermission("dd.lire");
  const mission = await chargerMission(id);
  if (!mission.ok) return null;
  const droits = droitsDd(utilisateur.roles, mission.donnees);
  const r = await chargerServeur<ReponseHypotheses>(cheminHypotheses(dossierId));
  if (!r.ok) {
    return (
      <EtatErreur
        titre="Les hypothèses n'ont pas pu être chargées."
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
        <Alerte tonalite="attention" titre="Incohérences dans l'arbre" annonce="aucune">
          <p>
            {`${arbre.incoherences.length} hypothèse(s) ont un verdict contradictoire avec leurs sous-hypothèses (parent confirmé avec un enfant infirmé, ou parent infirmé dont tous les enfants sont confirmés). Revoyez-les avant de soumettre la note.`}
          </p>
        </Alerte>
      ) : null}
      <Carte titre="Arbre des hypothèses" niveauTitre={3}>
        {noeuds.length === 0 ? (
          <EtatVide titre="Aucune hypothèse." icone="bulle">
            <p>
              {droits.ecrire
                ? "Posez les hypothèses à confirmer ou à infirmer : chacune se jugera sur des assertions sourcées."
                : "Les hypothèses apparaîtront ici dès qu'un consultant les aura posées."}
            </p>
          </EtatVide>
        ) : (
          <ArbreHypotheses missionId={id} dossierId={dossierId} arbre={construireArbre(noeuds)} />
        )}
      </Carte>
      {droits.ecrire ? (
        <Carte titre="Nouvelle hypothèse" niveauTitre={3}>
          <FormulaireHypothese dossierId={dossierId} parents={parents} />
        </Carte>
      ) : null}
    </>
  );
}
