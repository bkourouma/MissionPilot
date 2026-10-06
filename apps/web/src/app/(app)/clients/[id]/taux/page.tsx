import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { Onglets } from "../../../../../components/ui/Onglets";
import { chargerServeur } from "../../../../../lib/api-serveur";
import type { ClientDetaille } from "../../../../../lib/clients";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { chargerGradesActifs } from "../../../../../lib/referentiels-serveur";
import { exigerPermission } from "../../../../../lib/session";
import { ongletsClientAvecPortail } from "../../../../../lib/portail-gestion";
import { voitTauxNegocies, type TauxClient } from "../../../../../lib/taux-clients";
import { TauxNegocies } from "./TauxNegocies";

export const metadata: Metadata = { title: "Taux négociés" };

/**
 * Taux de vente négociés du client (FIN-02). Grille confidentielle : sans « finance.lire » ET
 * « taux.gerer », la page n'interroge pas l'API et renvoie vers « Accès refusé ».
 */
export default async function PageTauxClient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("clients.lire");
  if (!voitTauxNegocies(utilisateur.roles)) redirect("/acces-refuse");
  const [client, taux, grades] = await Promise.all([
    chargerServeur<ClientDetaille>(`/api/clients/${id}`),
    chargerServeur<{ elements: TauxClient[] }>(`/api/clients/${id}/taux`),
    chargerGradesActifs(utilisateur.roles),
  ]);
  if (!client.ok && client.statut === 404) notFound();
  const c = client.ok ? client.donnees : null;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={c?.raison_sociale ?? "Fiche client"}
        retour={{ href: "/clients", libelle: "Clients" }}
        badges={c && !c.actif ? <BadgeStatut tonalite="neutre">Archivé</BadgeStatut> : undefined}
        soustitre="Taux journaliers de vente négociés avec ce client. Ils priment sur le taux standard du grade dans les propositions et les budgets."
      />
      <Onglets
        libelle="Sections de la fiche client"
        pages={ongletsClientAvecPortail(id, utilisateur.roles)}
      />
      <Alerte tonalite="info" annonce="aucune" titre="Donnée confidentielle">
        <p>Visible des seuls associés et gestionnaires (grille de taux du cabinet).</p>
      </Alerte>
      {!taux.ok ? (
        <EtatErreur
          titre="Les taux négociés n'ont pas pu être chargés."
          message={taux.message}
          hrefReessayer={`/clients/${id}/taux`}
        />
      ) : (
        <TauxNegocies
          clientId={id}
          clientActif={c?.actif ?? true}
          taux={taux.donnees.elements}
          grades={grades.map((g) => ({ valeur: g.id, libelle: g.libelle }))}
        />
      )}
    </div>
  );
}
