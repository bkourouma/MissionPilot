import type { Metadata } from "next";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { obtenirT } from "../../../../../lib/i18n/serveur";
import type { VersionDocument } from "../../../../../lib/documents";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../lib/session";
import { DocumentsMission } from "./DocumentsMission";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Documents de la mission", "Engagement documents") };
}

/** Documents de la mission (SOC-05) : version courante de chaque document, dépôts, validation. */
export default async function PageDocumentsMission({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await obtenirT();
  const { utilisateur } = await exigerPermission("mission.lire");
  const r = await chargerMission(id);
  // L'en-tête (layout) affiche déjà l'erreur de chargement.
  if (!r.ok) return null;
  const m = r.donnees;
  const documents = await chargerServeur<{ elements: VersionDocument[] }>(
    `/api/missions/${m.id}/documents`,
  );
  if (!documents.ok) {
    return (
      <EtatErreur
        titre={t("Les documents n'ont pas pu être chargés.", "The documents could not be loaded.")}
        message={documents.message}
        hrefReessayer={`/missions/${m.id}/documents`}
      />
    );
  }
  return (
    <DocumentsMission
      missionId={m.id}
      documents={documents.donnees.elements}
      contexte={{
        roles: utilisateur.roles,
        utilisateurId: utilisateur.id,
        chefId: m.chef_id,
        directeurId: m.directeur_id,
        missionCloturee: m.statut === "cloturee",
      }}
    />
  );
}
