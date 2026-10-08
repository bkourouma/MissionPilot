import Link from "next/link";
import type { Metadata } from "next";
import { BadgePartage } from "../../../../../components/plan/BadgeStatutPlan";
import { FormulaireCreationPlan } from "../../../../../components/plan/FormulaireCreationPlan";
import "../../../../../components/plan/plan.css";
import { Alerte } from "../../../../../components/ui/Alerte";
import { Carte } from "../../../../../components/ui/Carte";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDate } from "../../../../../lib/format";
import { chargerMission } from "../../../../../lib/missions-serveur";
import {
  cheminPlansMission,
  droitsPlan,
  hrefPlan,
  hrefPlans,
  lireCurseur,
  raisonCreationImpossible,
  type PagePlans,
} from "../../../../../lib/plan-strategique";
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Plan stratégique de la mission" };

const TAILLE_PAGE = 20;

/**
 * Plans stratégiques d'une mission (service #3) : liste paginée et création par un
 * responsable de la mission. Chaque plan réunit diagnostic, SWOT, vision et mission, axes,
 * objectifs, initiatives et modèle financier. Rendu serveur, rien dans le navigateur.
 */
export default async function PagePlansMission({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("plan.lire");
  const r = await chargerMission(id);
  // L'en-tête (layout) affiche déjà l'erreur de chargement de la mission.
  if (!r.ok) return null;
  const m = r.donnees;
  const ctx = { roles: utilisateur.roles, utilisateurId: utilisateur.id, mission: m };
  const droits = droitsPlan(ctx);
  const curseur = lireCurseur((await searchParams).curseur);
  const plans = await chargerServeur<PagePlans>(cheminPlansMission(m.id, TAILLE_PAGE, curseur));
  const raison = raisonCreationImpossible(ctx);

  return (
    <div className="mp-plan">
      <p className="mp-texte-doux">
        Le plan stratégique réunit le diagnostic, l&apos;analyse SWOT, la vision, les axes, les
        objectifs, les initiatives et le modèle financier prévisionnel. L&apos;expert dispose :
        chaque contenu est validé par un responsable de la mission avant tout partage au client, et
        les chiffres du modèle sont calculés par le moteur de MissionPilot.
      </p>

      <Carte titre="Plans de la mission">
        {!plans.ok ? (
          <EtatErreur
            titre="Les plans de la mission n'ont pas pu être chargés."
            message={plans.message}
            hrefReessayer={hrefPlans(m.id)}
          />
        ) : plans.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucun plan stratégique pour cette mission." icone="drapeau">
            <p>
              {droits.creer
                ? "Créez le premier plan ci-dessous : vous pourrez ensuite en rédiger les contenus avec l'équipe."
                : "Un responsable de la mission (directeur, chef de mission ou associé) doit d'abord créer le plan."}
            </p>
          </EtatVide>
        ) : (
          <>
            <ul className="mp-plan-liste">
              {plans.donnees.elements.map((p) => (
                <li key={p.id} className="mp-plan-liste__element">
                  <h3 className="mp-plan-liste__titre">
                    <Link href={hrefPlan(m.id, p.id)}>{p.titre}</Link>
                  </h3>
                  <div className="mp-plan__badges">
                    <BadgePartage partage={p.partage_client} />
                    <span className="mp-texte-doux mp-texte-petit">
                      {`Horizon ${p.horizon} ans · ${p.devise} · créé le ${formaterDate(p.cree_le, "Africa/Abidjan")}`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <PaginationCurseur
              libelle="Pages des plans"
              hrefSuivante={
                plans.donnees.curseur_suivant
                  ? `${hrefPlans(m.id)}?curseur=${encodeURIComponent(plans.donnees.curseur_suivant)}`
                  : null
              }
              hrefDebut={curseur ? hrefPlans(m.id) : null}
            />
          </>
        )}
      </Carte>

      <Carte titre="Nouveau plan stratégique">
        {droits.creer ? (
          <FormulaireCreationPlan missionId={m.id} deviseMission={m.devise} />
        ) : (
          <Alerte tonalite="info" annonce="aucune">
            <p>{raison}</p>
          </Alerte>
        )}
      </Carte>
    </div>
  );
}
