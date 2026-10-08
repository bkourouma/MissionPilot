import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { Alerte } from "../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { Tableau, type ColonneTableau } from "../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDate, formaterJours, formaterMontantMineur } from "../../../../lib/format";
import { STATUT_MISSION } from "../../../../lib/missions";
import { type EncoursMission, type ReponseEncours } from "../../../../lib/rentabilite";
import { obtenirSession } from "../../../../lib/session";

export const metadata: Metadata = { title: "Encours de production" };

const montant = (v: number | undefined, e: EncoursMission) =>
  v === undefined ? "—" : formaterMontantMineur(v, e.devise ?? "XOF");

export default async function PageEncours() {
  const { utilisateur } = await obtenirSession();
  const roles = utilisateur.roles;
  if (!aPermission(roles, "facture.lire") && !aPermission(roles, "indicateurs.cabinet"))
    redirect("/acces-refuse");
  const r = await chargerServeur<ReponseEncours>("/api/finance/encours");
  // Colonnes monétaires seulement si l'API a servi la valorisation (finance.lire).
  const valorise = r.ok && r.donnees.cabinet !== undefined;
  const colonnes: ColonneTableau<EncoursMission>[] = [
    {
      cle: "mission",
      entete: "Mission",
      rendu: (e) => <Link href={`/missions/${e.mission_id}/facturation`}>{e.intitule}</Link>,
    },
    {
      cle: "statut",
      entete: "Statut",
      rendu: (e) => (
        <BadgeStatut tonalite={STATUT_MISSION[e.statut].tonalite}>
          {STATUT_MISSION[e.statut].libelle}
        </BadgeStatut>
      ),
    },
    {
      cle: "jours",
      entete: "Jours validés",
      alignement: "droite",
      rendu: (e) => formaterJours(e.jours_valides),
    },
    ...(valorise
      ? ([
          {
            cle: "produit",
            entete: "Valeur produite",
            alignement: "droite",
            rendu: (e) => montant(e.valeur_produite, e),
          },
          {
            cle: "facture",
            entete: "Honoraires facturés",
            alignement: "droite",
            rendu: (e) => montant(e.honoraires_factures, e),
          },
          {
            cle: "encours",
            entete: "Encours (non facturé)",
            alignement: "droite",
            rendu: (e) => <strong>{montant(e.encours_production, e)}</strong>,
          },
          {
            cle: "avance",
            entete: "Facturé d'avance",
            alignement: "droite",
            rendu: (e) => montant(e.facture_d_avance, e),
          },
        ] satisfies ColonneTableau<EncoursMission>[])
      : []),
  ];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Encours de production"
        soustitre="Valeur des temps réalisés et validés non encore facturés, et facturé d'avance, par mission signée."
      />
      {!r.ok ? (
        <EtatErreur
          titre="L'encours n'a pas pu être chargé."
          message={r.message}
          hrefReessayer="/finance/encours"
        />
      ) : (
        <>
          {r.donnees.cabinet ? (
            <Carte titre={`Cabinet au ${formaterDate(r.donnees.date)}`}>
              <ul className="mp-totaux">
                <li className="mp-totaux__element">
                  <span className="mp-totaux__libelle">Encours de production</span>
                  <span className="mp-totaux__valeur">
                    {formaterMontantMineur(
                      r.donnees.cabinet.encours_production,
                      r.donnees.cabinet.devise,
                    )}
                  </span>
                </li>
                <li className="mp-totaux__element">
                  <span className="mp-totaux__libelle">Facturé d&apos;avance</span>
                  <span className="mp-totaux__valeur">
                    {formaterMontantMineur(
                      r.donnees.cabinet.facture_d_avance,
                      r.donnees.cabinet.devise,
                    )}
                  </span>
                </li>
              </ul>
              {r.donnees.missions_exclues && r.donnees.missions_exclues.length > 0 ? (
                <p className="mp-texte-doux">
                  {`${r.donnees.missions_exclues.length} mission(s) exclue(s) du total : taux de change non figé.`}
                </p>
              ) : null}
            </Carte>
          ) : (
            <Alerte tonalite="info" annonce="aucune" titre="Valorisation non affichée">
              <p>
                Valorisation réservée aux associés et gestionnaires. Seuls les jours validés sont
                présentés.
              </p>
            </Alerte>
          )}
          {r.donnees.missions.length === 0 ? (
            <EtatVide titre="Aucune mission signée pour l'instant." icone="dossier" />
          ) : (
            <Tableau
              legende={`Encours par mission au ${formaterDate(r.donnees.date)}`}
              legendeVisible
              lignes={r.donnees.missions}
              cleLigne={(e) => e.mission_id}
              colonnes={colonnes}
            />
          )}
        </>
      )}
    </div>
  );
}
