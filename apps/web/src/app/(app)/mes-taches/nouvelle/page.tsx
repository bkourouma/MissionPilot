import type { Metadata } from "next";
import { aPermission, type Role, type TypeEntiteCollaboration } from "@missionpilot/shared";
import { Alerte } from "../../../../components/ui/Alerte";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { chargerServeur } from "../../../../lib/api-serveur";
import { designationFacture, type Facture } from "../../../../lib/factures";
import type { Mission } from "../../../../lib/missions";
import { optionsPersonnes } from "../../../../lib/personnes";
import { chargerPersonnes } from "../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../lib/session";
import {
  ENTITE_LIBELLES,
  lireEntiteLiee,
  valeurEntite,
} from "../../../../lib/taches-collaboration";
import { NouvelleTache } from "./NouvelleTache";

export const metadata: Metadata = { title: "Nouvelle tâche" };

/** Libellé et écran de retour de l'élément lié (lu seulement avec le droit de le voir). */
async function decrireEntite(
  type: TypeEntiteCollaboration,
  id: string,
  roles: readonly Role[],
): Promise<{ libelle: string; retour: string }> {
  const generique = { libelle: ENTITE_LIBELLES[type], retour: "/mes-taches" };
  if (type === "mission" && aPermission(roles, "mission.lire")) {
    const r = await chargerServeur<Mission>(`/api/missions/${id}`);
    if (r.ok) return { libelle: `Mission « ${r.donnees.intitule} »`, retour: `/missions/${id}` };
  }
  if (type === "facture" && aPermission(roles, "facture.lire")) {
    const r = await chargerServeur<Facture>(`/api/factures/${id}`);
    if (r.ok) return { libelle: designationFacture(r.donnees), retour: `/facturation/${id}` };
  }
  if ((type === "opportunite" || type === "proposition") && aPermission(roles, "pipeline.gerer")) {
    const chemin = type === "opportunite" ? "opportunites" : "propositions";
    const r = await chargerServeur<{ intitule: string }>(`/api/${chemin}/${id}`);
    const ecran = type === "opportunite" ? `/pipeline/${id}` : `/pipeline/propositions/${id}`;
    if (r.ok)
      return { libelle: `${ENTITE_LIBELLES[type]} « ${r.donnees.intitule} »`, retour: ecran };
  }
  return generique;
}

/** Missions ouvertes proposées comme élément lié (sans élément imposé). */
async function missionsLiables(roles: readonly Role[]) {
  if (!aPermission(roles, "mission.lire")) return [];
  const r = await chargerServeur<{ elements: Mission[] }>("/api/missions");
  if (!r.ok) return [];
  return r.donnees.elements
    .filter((m) => m.statut !== "cloturee")
    .map((m) => ({ valeur: valeurEntite("mission", m.id), libelle: `Mission : ${m.intitule}` }));
}

export default async function PageNouvelleTache({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("tache.assigner");
  const roles = utilisateur.roles;
  const entite = lireEntiteLiee(await searchParams);
  const [personnes, missions, description] = await Promise.all([
    chargerPersonnes(roles),
    entite ? Promise.resolve([]) : missionsLiables(roles),
    entite ? decrireEntite(entite.type, entite.id, roles) : Promise.resolve(null),
  ]);
  const options = optionsPersonnes(personnes).map((o) =>
    o.valeur === utilisateur.id ? { ...o, libelle: `${o.libelle} (vous)` } : o,
  );

  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre="Nouvelle tâche"
        retour={{
          href: description?.retour ?? "/mes-taches",
          libelle: description ? "Retour" : "Mes tâches",
        }}
        soustitre="Confiez une action précise à un collègue : il est notifié et la retrouve dans « Mes tâches »."
      />
      <Carte>
        {options.length === 0 ? (
          <Alerte tonalite="attention" titre="Aucune personne assignable">
            <p>
              Aucun collaborateur actif lié à un compte utilisateur n&apos;est visible. Un associé
              ou le responsable des ressources peut rattacher les comptes aux collaborateurs.
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
