import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { aPermission, creerTraduire, type Langue } from "@missionpilot/shared";
import { Alerte } from "../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { Tableau, type ColonneTableau } from "../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDate, formaterJours, formaterMontantMineur } from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { libelleStatutMission, STATUT_MISSION } from "../../../../lib/missions";
import { type EncoursMission, type ReponseEncours } from "../../../../lib/rentabilite";
import { obtenirSession } from "../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Encours de production", "Work in progress") };
}

const montant = (v: number | undefined, e: EncoursMission, langue: Langue) =>
  v === undefined ? "—" : formaterMontantMineur(v, e.devise ?? "XOF", langue);

export default async function PageEncours() {
  const { utilisateur } = await obtenirSession();
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  const roles = utilisateur.roles;
  if (!aPermission(roles, "facture.lire") && !aPermission(roles, "indicateurs.cabinet"))
    redirect("/acces-refuse");
  const r = await chargerServeur<ReponseEncours>("/api/finance/encours");
  // Colonnes monétaires seulement si l'API a servi la valorisation (finance.lire).
  const valorise = r.ok && r.donnees.cabinet !== undefined;
  const colonnes: ColonneTableau<EncoursMission>[] = [
    {
      cle: "mission",
      entete: t("Mission", "Engagement"),
      rendu: (e) => <Link href={`/missions/${e.mission_id}/facturation`}>{e.intitule}</Link>,
    },
    {
      cle: "statut",
      entete: t("Statut", "Status"),
      rendu: (e) => (
        <BadgeStatut tonalite={STATUT_MISSION[e.statut].tonalite}>
          {libelleStatutMission(e.statut, langue)}
        </BadgeStatut>
      ),
    },
    {
      cle: "jours",
      entete: t("Jours validés", "Approved days"),
      alignement: "droite",
      rendu: (e) => formaterJours(e.jours_valides, langue),
    },
    ...(valorise
      ? ([
          {
            cle: "produit",
            entete: t("Valeur produite", "Value produced"),
            alignement: "droite",
            rendu: (e) => montant(e.valeur_produite, e, langue),
          },
          {
            cle: "facture",
            entete: t("Honoraires facturés", "Fees invoiced"),
            alignement: "droite",
            rendu: (e) => montant(e.honoraires_factures, e, langue),
          },
          {
            cle: "encours",
            entete: t("Encours (non facturé)", "Work in progress (not invoiced)"),
            alignement: "droite",
            rendu: (e) => <strong>{montant(e.encours_production, e, langue)}</strong>,
          },
          {
            cle: "avance",
            entete: t("Facturé d'avance", "Billed in advance"),
            alignement: "droite",
            rendu: (e) => montant(e.facture_d_avance, e, langue),
          },
        ] satisfies ColonneTableau<EncoursMission>[])
      : []),
  ];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Encours de production", "Work in progress")}
        soustitre={t(
          "Valeur des temps réalisés et validés non encore facturés, et facturé d'avance, par mission signée.",
          "Value of approved time not yet invoiced, and amounts billed in advance, by signed engagement.",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "L'encours n'a pas pu être chargé.",
            "The work in progress could not be loaded.",
          )}
          message={r.message}
          hrefReessayer="/finance/encours"
        />
      ) : (
        <>
          {r.donnees.cabinet ? (
            <Carte
              titre={t(
                `Cabinet au ${formaterDate(r.donnees.date)}`,
                `Firm as of ${formaterDate(r.donnees.date, "UTC", langue)}`,
              )}
            >
              <ul className="mp-totaux">
                <li className="mp-totaux__element">
                  <span className="mp-totaux__libelle">
                    {t("Encours de production", "Work in progress")}
                  </span>
                  <span className="mp-totaux__valeur">
                    {formaterMontantMineur(
                      r.donnees.cabinet.encours_production,
                      r.donnees.cabinet.devise,
                      langue,
                    )}
                  </span>
                </li>
                <li className="mp-totaux__element">
                  <span className="mp-totaux__libelle">
                    {t("Facturé d'avance", "Billed in advance")}
                  </span>
                  <span className="mp-totaux__valeur">
                    {formaterMontantMineur(
                      r.donnees.cabinet.facture_d_avance,
                      r.donnees.cabinet.devise,
                      langue,
                    )}
                  </span>
                </li>
              </ul>
              {r.donnees.missions_exclues && r.donnees.missions_exclues.length > 0 ? (
                <p className="mp-texte-doux">
                  {t(
                    `${r.donnees.missions_exclues.length} mission(s) exclue(s) du total : taux de change non figé.`,
                    `${r.donnees.missions_exclues.length} engagement(s) excluded from the total: exchange rate not locked.`,
                  )}
                </p>
              ) : null}
            </Carte>
          ) : (
            <Alerte
              tonalite="info"
              annonce="aucune"
              titre={t("Valorisation non affichée", "Valuation not shown")}
            >
              <p>
                {t(
                  "Valorisation réservée aux associés et gestionnaires. Seuls les jours validés sont présentés.",
                  "Valuation is reserved for partners and managers. Only approved days are shown.",
                )}
              </p>
            </Alerte>
          )}
          {r.donnees.missions.length === 0 ? (
            <EtatVide
              titre={t("Aucune mission signée pour l'instant.", "No signed engagement yet.")}
              icone="dossier"
            />
          ) : (
            <div className="mp-tableau-dense">
              <Tableau
                legende={t(
                  `Encours par mission au ${formaterDate(r.donnees.date)}`,
                  `Work in progress by engagement as of ${formaterDate(r.donnees.date, "UTC", langue)}`,
                )}
                legendeVisible
                lignes={r.donnees.missions}
                cleLigne={(e) => e.mission_id}
                colonnes={colonnes}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
