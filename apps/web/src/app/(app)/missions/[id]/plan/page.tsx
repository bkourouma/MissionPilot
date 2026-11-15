import Link from "next/link";
import type { Metadata } from "next";
import { BadgePartage } from "../../../../../components/plan/BadgeStatutPlan";
import { FormulaireCreationPlan } from "../../../../../components/plan/FormulaireCreationPlan";
import "../../../../../components/plan/plan.css";
import { Alerte } from "../../../../../components/ui/Alerte";
import { Carte } from "../../../../../components/ui/Carte";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDate, libelleDevise } from "../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Plan stratégique de la mission", "Engagement strategic plan") };
}

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
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
  const raison = raisonCreationImpossible(ctx, langue);

  return (
    <div className="mp-plan">
      <p className="mp-texte-doux">
        {t(
          "Le plan stratégique réunit le diagnostic, l'analyse SWOT, la vision, les axes, les objectifs, les initiatives et le modèle financier prévisionnel. L'expert dispose : chaque contenu est validé par un responsable de la mission avant tout partage au client, et les chiffres du modèle sont calculés par le moteur de CabinetPilot.",
          "The strategic plan brings together the diagnostic, SWOT analysis, vision, axes, objectives, initiatives and the projected financial model. The expert decides: each item is approved by an engagement lead before anything is shared with the client, and the model figures are computed by the CabinetPilot engine.",
        )}
      </p>

      <Carte titre={t("Plans de la mission", "Engagement plans")}>
        {!plans.ok ? (
          <EtatErreur
            titre={t(
              "Les plans de la mission n'ont pas pu être chargés.",
              "The engagement plans could not be loaded.",
            )}
            message={plans.message}
            hrefReessayer={hrefPlans(m.id)}
          />
        ) : plans.donnees.elements.length === 0 ? (
          <EtatVide
            titre={t(
              "Aucun plan stratégique pour cette mission.",
              "No strategic plan for this engagement.",
            )}
            icone="drapeau"
          >
            <p>
              {droits.creer
                ? t(
                    "Créez le premier plan ci-dessous : vous pourrez ensuite en rédiger les contenus avec l'équipe.",
                    "Create the first plan below: you can then write its content with the team.",
                  )
                : t(
                    "Un responsable de la mission (directeur, chef de mission ou associé) doit d'abord créer le plan.",
                    "An engagement lead (director, engagement manager or partner) must create the plan first.",
                  )}
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
                      {t(
                        `Horizon ${p.horizon} ans · ${libelleDevise(p.devise)} · créé le ${formaterDate(p.cree_le, "Africa/Abidjan")}`,
                        `Horizon ${p.horizon} years · ${libelleDevise(p.devise)} · created on ${formaterDate(p.cree_le, "Africa/Abidjan", langue)}`,
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <PaginationCurseur
              libelle={t("Pages des plans", "Plan pages")}
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

      <Carte titre={t("Nouveau plan stratégique", "New strategic plan")}>
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
