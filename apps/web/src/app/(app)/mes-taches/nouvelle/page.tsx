import type { Metadata } from "next";
import {
  aPermission,
  type Langue,
  type Role,
  type TypeEntiteCollaboration,
} from "@missionpilot/shared";
import { Alerte } from "../../../../components/ui/Alerte";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { chargerServeur } from "../../../../lib/api-serveur";
import { obtenirLangue } from "../../../../lib/i18n/serveur";
import { chargerToutesLesPages, LIMITE_PAGE_MAX } from "../../../../lib/pagination";
import { designationFacture, type Facture } from "../../../../lib/factures";
import type { Mission } from "../../../../lib/missions";
import { optionsPersonnes } from "../../../../lib/personnes";
import { chargerPersonnes } from "../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../lib/session";
import { libelleEntite, lireEntiteLiee, valeurEntite } from "../../../../lib/taches-collaboration";
import { NouvelleTache } from "./NouvelleTache";

export async function generateMetadata(): Promise<Metadata> {
  const langue = await obtenirLangue();
  return { title: langue === "en" ? "New task" : "Nouvelle tâche" };
}

/** Libellé et écran de retour de l'élément lié (lu seulement avec le droit de le voir). */
async function decrireEntite(
  type: TypeEntiteCollaboration,
  id: string,
  roles: readonly Role[],
  langue: Langue,
): Promise<{ libelle: string; retour: string }> {
  const en = langue === "en";
  const generique = { libelle: libelleEntite(type, langue), retour: "/mes-taches" };
  if (type === "mission" && aPermission(roles, "mission.lire")) {
    const r = await chargerServeur<Mission>(`/api/missions/${id}`);
    if (r.ok) {
      return {
        libelle: en ? `Engagement "${r.donnees.intitule}"` : `Mission « ${r.donnees.intitule} »`,
        retour: `/missions/${id}`,
      };
    }
  }
  if (type === "facture" && aPermission(roles, "facture.lire")) {
    const r = await chargerServeur<Facture>(`/api/factures/${id}`);
    if (r.ok)
      return { libelle: designationFacture(r.donnees, langue), retour: `/facturation/${id}` };
  }
  if ((type === "opportunite" || type === "proposition") && aPermission(roles, "pipeline.gerer")) {
    const chemin = type === "opportunite" ? "opportunites" : "propositions";
    const r = await chargerServeur<{ intitule: string }>(`/api/${chemin}/${id}`);
    const ecran = type === "opportunite" ? `/pipeline/${id}` : `/pipeline/propositions/${id}`;
    if (r.ok)
      return {
        libelle: en
          ? `${libelleEntite(type, langue)} "${r.donnees.intitule}"`
          : `${libelleEntite(type)} « ${r.donnees.intitule} »`,
        retour: ecran,
      };
  }
  return generique;
}

/** Missions ouvertes proposées comme élément lié (sans élément imposé). */
async function missionsLiables(roles: readonly Role[], langue: Langue) {
  if (!aPermission(roles, "mission.lire")) return [];
  const r = await chargerToutesLesPages<Mission>(chargerServeur, "/api/missions", {
    limiteMax: LIMITE_PAGE_MAX,
  });
  if (!r.ok) return [];
  return r.donnees.elements
    .filter((m) => m.statut !== "cloturee")
    .map((m) => ({
      valeur: valeurEntite("mission", m.id),
      libelle: `${langue === "en" ? "Engagement" : "Mission"} : ${m.intitule}`,
    }));
}

export default async function PageNouvelleTache({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("tache.assigner");
  const langue = await obtenirLangue();
  const t = (fr: string, en: string) => (langue === "en" ? en : fr);
  const roles = utilisateur.roles;
  const entite = lireEntiteLiee(await searchParams);
  const [personnes, missions, description] = await Promise.all([
    chargerPersonnes(roles),
    entite ? Promise.resolve([]) : missionsLiables(roles, langue),
    entite ? decrireEntite(entite.type, entite.id, roles, langue) : Promise.resolve(null),
  ]);
  const options = optionsPersonnes(personnes).map((o) =>
    o.valeur === utilisateur.id ? { ...o, libelle: `${o.libelle} (${t("vous", "you")})` } : o,
  );

  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={t("Nouvelle tâche", "New task")}
        retour={{
          href: description?.retour ?? "/mes-taches",
          libelle: description ? t("Retour", "Back") : t("Mes tâches", "My tasks"),
        }}
        soustitre={t(
          "Confiez une action précise à un collègue : il est notifié et la retrouve dans « Mes tâches ».",
          'Give a colleague a specific action: they are notified and find it in "My tasks".',
        )}
      />
      <Carte>
        {options.length === 0 ? (
          <Alerte
            tonalite="attention"
            titre={t("Aucune personne assignable", "No assignable person")}
          >
            <p>
              {t(
                "Aucun collaborateur actif lié à un compte utilisateur n'est visible. Un associé ou le responsable des ressources peut rattacher les comptes aux collaborateurs.",
                "No active team member linked to a user account is visible. A partner or the resources manager can link accounts to team members.",
              )}
            </p>
          </Alerte>
        ) : (
          <NouvelleTache
            personnes={options}
            entites={missions}
            entite={entite ? valeurEntite(entite.type, entite.id) : ""}
            entiteImposee={description?.libelle}
            retour={description?.retour ?? "/mes-taches"}
          />
        )}
      </Carte>
    </div>
  );
}
