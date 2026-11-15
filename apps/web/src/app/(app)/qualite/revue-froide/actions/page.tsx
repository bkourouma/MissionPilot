import Link from "next/link";
import type { Metadata } from "next";
import "../../../../../components/qualite/froide.css";
import "../../../../../components/qualite/qualite.css";
import { FroideListeActions } from "../../../../../components/qualite/FroideListeActions";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { STATUTS_ACTION_FROIDE } from "@missionpilot/shared";
import {
  cheminAction,
  cheminActions,
  droitsQualiteFroide,
  HREF_REVUE_FROIDE,
  hrefActions,
  libelleStatutAction,
  lireFiltresActions,
  type ActionFroide,
  type PageActions,
} from "../../../../../lib/qualite-froide";
import { chargerResponsables } from "../../../../../lib/qualite-froide-serveur";
import { exigerConsultationQualite } from "../../../../../lib/qualite-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Mes actions d'amélioration", "My improvement actions") };
}

/**
 * Actions d'amélioration issues des revues à froid : celles dont l'utilisateur est responsable,
 * ou toutes pour l'associé (l'API filtre). Le responsable change le statut de son action ; la
 * clôture exige un commentaire. L'historique de chaque action est consultable.
 */
export default async function PageActionsFroides({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await exigerConsultationQualite();
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const droits = droitsQualiteFroide(session.utilisateur.roles);
  const filtres = lireFiltresActions(await searchParams);
  const page = await chargerServeur<PageActions>(cheminActions(filtres));
  const responsables = droits.gerer ? await chargerResponsables(session) : [];

  // Chaque ligne de la liste ne porte pas l'historique : on le charge par action affichée.
  const detaillees = page.ok
    ? await Promise.all(
        page.donnees.elements.map(async (a): Promise<ActionFroide> => {
          const d = await chargerServeur<ActionFroide>(cheminAction(a.id));
          return d.ok ? { ...a, ...d.donnees, campagne_intitule: a.campagne_intitule } : a;
        }),
      )
    : [];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={
          droits.gerer
            ? t("Actions d'amélioration", "Improvement actions")
            : t("Mes actions d'amélioration", "My improvement actions")
        }
        soustitre={
          droits.gerer
            ? t(
                "Toutes les actions des plans d'amélioration issus des revues à froid.",
                "All actions of the improvement plans arising from cold reviews.",
              )
            : t(
                "Les actions dont vous êtes responsable, issues des constats des revues à froid.",
                "The actions you are responsible for, arising from cold review findings.",
              )
        }
        retour={{ href: HREF_REVUE_FROIDE, libelle: t("Revue à froid", "Cold review") }}
      />

      <nav
        className="mp-qualite__entete-liste"
        aria-label={t("Filtrer les actions", "Filter actions")}
      >
        <Link
          href={hrefActions({ campagne: filtres.campagne })}
          className="mp-qualite__filtre"
          aria-current={filtres.statut === "" && !filtres.enRetard ? "true" : undefined}
        >
          {t("Toutes", "All")}
        </Link>
        {STATUTS_ACTION_FROIDE.map((s) => (
          <Link
            key={s}
            href={hrefActions({ campagne: filtres.campagne, statut: s })}
            className="mp-qualite__filtre"
            aria-current={filtres.statut === s ? "true" : undefined}
          >
            {libelleStatutAction(s, langue)}
          </Link>
        ))}
        <Link
          href={hrefActions({ campagne: filtres.campagne, enRetard: true })}
          className="mp-qualite__filtre"
          aria-current={filtres.enRetard ? "true" : undefined}
        >
          {t("En retard", "Overdue")}
        </Link>
      </nav>

      {!page.ok ? (
        <EtatErreur
          titre={t("Les actions n'ont pas pu être chargées.", "The actions could not be loaded.")}
          message={page.message}
          hrefReessayer={hrefActions(filtres)}
        />
      ) : detaillees.length === 0 ? (
        <EtatVide
          titre={
            filtres.curseur
              ? t("Aucune autre action.", "No more actions.")
              : t("Aucune action d'amélioration.", "No improvement action.")
          }
          icone="signature"
        >
          <p>
            {filtres.statut || filtres.enRetard
              ? t("Aucune action ne correspond à ce filtre.", "No action matches this filter.")
              : t(
                  "Les actions qui vous seront confiées après une revue à froid apparaîtront ici.",
                  "Actions assigned to you after a cold review will appear here.",
                )}
          </p>
        </EtatVide>
      ) : (
        <FroideListeActions
          actions={detaillees}
          utilisateurId={session.utilisateur.id}
          peutGerer={droits.gerer}
          responsables={responsables}
          afficherCampagne
        />
      )}
      {page.ok ? (
        <PaginationCurseur
          hrefSuivante={
            page.donnees.curseur_suivant
              ? hrefActions({ ...filtres, curseur: page.donnees.curseur_suivant })
              : null
          }
          hrefDebut={filtres.curseur ? hrefActions({ ...filtres, curseur: "" }) : null}
        />
      ) : null}
    </div>
  );
}
