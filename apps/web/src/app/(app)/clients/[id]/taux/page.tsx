import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Taux négociés", "Negotiated rates") };
}

/**
 * Taux de vente négociés du client (FIN-02). Grille confidentielle : sans « finance.lire » ET
 * « taux.gerer », la page n'interroge pas l'API et renvoie vers « Accès refusé ».
 */
export default async function PageTauxClient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
        titre={c?.raison_sociale ?? t("Fiche client", "Client profile")}
        retour={{ href: "/clients", libelle: t("Clients", "Clients") }}
        badges={
          c && !c.actif ? (
            <BadgeStatut tonalite="neutre">{t("Archivé", "Archived")}</BadgeStatut>
          ) : undefined
        }
        soustitre={t(
          "Taux journaliers de vente négociés avec ce client. Ils priment sur le taux standard du grade dans les propositions et les budgets.",
          "Daily selling rates negotiated with this client. They take precedence over the standard grade rate in proposals and budgets.",
        )}
      />
      <Onglets
        libelle={t("Sections de la fiche client", "Client profile sections")}
        pages={ongletsClientAvecPortail(id, utilisateur.roles, langue)}
      />
      <Alerte
        tonalite="info"
        annonce="aucune"
        titre={t("Donnée confidentielle", "Confidential data")}
      >
        <p>
          {t(
            "Visible des seuls associés et gestionnaires (grille de taux du cabinet).",
            "Visible to partners and managers only (the firm's rate grid).",
          )}
        </p>
      </Alerte>
      {!taux.ok ? (
        <EtatErreur
          titre={t(
            "Les taux négociés n'ont pas pu être chargés.",
            "Negotiated rates could not be loaded.",
          )}
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
