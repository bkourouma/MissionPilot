import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { EnteteDossier } from "../../../../../components/dossier/EnteteDossier";
import { ImportEtat } from "../../../../../components/dossier/ImportEtat";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  ORIGINE_ETAT_LIBELLES,
  STATUT_ETAT,
  type EtatFinancier,
  type VueDossier,
} from "../../../../../lib/dossier";
import { formaterDate, formaterMontantMineur } from "../../../../../lib/format";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { exigerPermission } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Finances du client" };

/** États financiers multi-exercices : statut des contrôles, revue, historique, import. */
export default async function PageFinances({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("dossier.lire");
  const peutEcrire = aPermission(utilisateur.roles, "dossier.ecrire");
  const [dossier, etats] = await Promise.all([
    chargerServeur<VueDossier>(`/api/dossiers/${id}`),
    chargerServeur<{ elements: EtatFinancier[] }>(`/api/dossiers/${id}/etats-financiers`),
  ]);
  if (!dossier.ok && dossier.statut === 404) notFound();
  if (!dossier.ok || !etats.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre="Finances du client"
          retour={{ href: `/dossiers/${id}`, libelle: "Dossier" }}
        />
        <EtatErreur
          titre="Les états financiers n'ont pas pu être chargés."
          message={!dossier.ok ? dossier.message : !etats.ok ? etats.message : ""}
          hrefReessayer={`/dossiers/${id}/finances`}
        />
      </div>
    );
  }
  const enRevue = etats.donnees.elements.filter((e) => e.statut === "en_revue").length;

  return (
    <div className="mp-page">
      <EnteteDossier client={dossier.donnees.client} fiabilite={dossier.donnees.fiabilite} />

      {enRevue > 0 ? (
        <Alerte tonalite="attention" titre={`${enRevue} état(s) en revue`} annonce="aucune">
          <p>
            Un état dont des contrôles échouent, ou qui ne peut pas être contrôlé entièrement,
            n&apos;est jamais accepté automatiquement : ouvrez-le pour l&apos;accepter (avec un
            motif) ou le rejeter.
          </p>
        </Alerte>
      ) : null}

      <Carte titre="États financiers">
        <Tableau
          legende="États financiers du client"
          lignes={etats.donnees.elements}
          cleLigne={(e) => e.id}
          messageVide="Aucun état financier ingéré."
          colonnes={[
            {
              cle: "exercice",
              entete: "Exercice",
              rendu: (e) => (
                <Link href={`/dossiers/${id}/finances/${e.id}`} className="mp-lien-ligne">
                  {e.exercice}
                </Link>
              ),
            },
            { cle: "date_cloture", entete: "Clôture", rendu: (e) => formaterDate(e.date_cloture) },
            {
              cle: "statut",
              entete: "Statut",
              rendu: (e) => (
                <BadgeStatut tonalite={STATUT_ETAT[e.statut].tonalite}>
                  {STATUT_ETAT[e.statut].libelle}
                </BadgeStatut>
              ),
            },
            {
              cle: "controles",
              entete: "Contrôles",
              rendu: (e) =>
                e.controles_ok
                  ? "Tous passés"
                  : `${e.ecarts} écart(s), ${e.non_verifiables} non vérifiable(s)`,
            },
            { cle: "origine", entete: "Origine", rendu: (e) => ORIGINE_ETAT_LIBELLES[e.origine] },
            {
              cle: "actif",
              entete: "Total actif",
              alignement: "droite",
              rendu: (e) => formaterMontantMineur(e.totaux.actif, e.devise),
            },
            {
              cle: "resultat",
              entete: "Résultat",
              alignement: "droite",
              rendu: (e) => formaterMontantMineur(e.totaux.resultat, e.devise),
            },
          ]}
        />
      </Carte>

      {peutEcrire ? (
        <Carte titre="Importer un état financier">
          <ImportEtat clientId={id} />
          <p>
            L&apos;extraction automatique depuis une liasse PDF n&apos;est pas encore disponible :
            importez un classeur ou un CSV. Un nouvel état du même exercice remplace l&apos;état
            courant (l&apos;historique reste consultable).
          </p>
        </Carte>
      ) : null}
    </div>
  );
}
