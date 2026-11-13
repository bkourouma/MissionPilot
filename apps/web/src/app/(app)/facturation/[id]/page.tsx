import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aPermission, creerTraduire, type Langue, type Traduire } from "@missionpilot/shared";
import { CarteCommentaires } from "../../../../components/collaboration/CarteCommentaires";
import { BadgePaiement } from "../../../../components/finance/BadgePaiement";
import { LienFacturePdf } from "../../../../components/rapports/LienFacturePdf";
import { Alerte } from "../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { Icone } from "../../../../components/ui/Icone";
import { chargerServeur } from "../../../../lib/api-serveur";
import {
  actionsFacture,
  designationFacture,
  factureDetailleeVisible,
  libelleNature,
  libelleStatutFacture,
  ROLE_APPROBATEUR_LIBELLES,
  ROLE_APPROBATEUR_LIBELLES_EN,
  STATUT_FACTURE,
  type FactureDetaillee,
} from "../../../../lib/factures";
import { formaterDate, formaterDateHeure, libelleDevise } from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../lib/identifiant";
import type { MissionDetaillee } from "../../../../lib/missions";
import type { ParametresFacturation } from "../../../../lib/parametres-facturation";
import { exigerPermission } from "../../../../lib/session";
import type { PaiementFacture as Paiement } from "../../../../lib/encaissements";
import { ActionsFacture } from "./ActionsFacture";
import { PaiementFacture } from "./PaiementFacture";
import { LignesFacture, TotauxFacture } from "./ContenuFacture";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Facture", "Invoice") };
}

export default async function PageFacture({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("facture.lire");
  const roles = utilisateur.roles;
  const r = await chargerServeur<FactureDetaillee>(`/api/factures/${id}`);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre={t("Facture", "Invoice")}
          retour={{ href: "/facturation", libelle: t("Facturation", "Billing") }}
        />
        <EtatErreur
          titre={t("La facture n'a pas pu être chargée.", "The invoice could not be loaded.")}
          message={r.message}
          hrefReessayer={`/facturation/${id}`}
        />
      </div>
    );
  }
  // Défense en profondeur : seuls les champs de facturation connus sont rendus.
  const f = factureDetailleeVisible(r.donnees);
  const suiviPaiement = f.nature === "facture" && (f.statut === "emise" || f.statut === "annulee");
  const [mission, parametres, paiement] = await Promise.all([
    chargerServeur<MissionDetaillee>(`/api/missions/${f.mission_id}`),
    aPermission(roles, "facture.emettre") && f.statut === "brouillon"
      ? chargerServeur<ParametresFacturation>("/api/parametres-facturation")
      : Promise.resolve(null),
    suiviPaiement
      ? chargerServeur<Paiement>(`/api/factures/${f.id}/paiement`)
      : Promise.resolve(null),
  ]);
  const actions = actionsFacture(
    f,
    {
      roles,
      utilisateurId: utilisateur.id,
      directeurId: mission.ok ? mission.donnees.directeur_id : null,
    },
    langue,
  );
  const statut = STATUT_FACTURE[f.statut];
  const tauxAutorises = parametres?.ok
    ? parametres.donnees.taux_tva_autorises
    : [f.lignes[0]?.taux_tva ?? 0];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={designationFacture(f, langue)}
        retour={{ href: "/facturation", libelle: t("Facturation", "Billing") }}
        badges={
          <>
            <BadgeStatut tonalite={statut.tonalite}>
              {libelleStatutFacture(f.statut, langue)}
            </BadgeStatut>
            {f.envoyee_le ? (
              <BadgeStatut tonalite="succes">{t("Envoyée", "Sent")}</BadgeStatut>
            ) : null}
            {paiement?.ok && paiement.donnees.statut_paiement ? (
              <BadgePaiement
                statut={paiement.donnees.statut_paiement}
                joursRetard={paiement.donnees.jours_retard}
              />
            ) : null}
          </>
        }
        soustitre={`${f.client_raison_sociale} · ${f.mission_intitule} · ${libelleDevise(f.devise)}`}
      />
      <Bandeaux f={f} raison={actions.raisonRefusApprobation} langue={langue} />
      <Carte titre={t("Informations", "Information")}>
        <Informations f={f} langue={langue} />
      </Carte>
      <Carte titre={t("Lignes", "Lines")}>
        <LignesFacture facture={f} modifiable={actions.modifier} tauxAutorises={tauxAutorises} />
      </Carte>
      <Carte titre={t("Totaux", "Totals")}>
        <TotauxFacture facture={f} />
      </Carte>
      {paiement?.ok ? (
        <PaiementFacture
          paiement={paiement.donnees}
          devise={f.devise}
          gererEncaissements={aPermission(roles, "encaissement.gerer")}
        />
      ) : null}
      <Carte titre={t("Document", "Document")}>
        <div className="mp-pile">
          <p className="mp-texte-doux">
            {t(
              "Aperçu imprimable produit par le serveur (mentions légales, lignes et totaux). Il s'ouvre dans un nouvel onglet ; utilisez l'impression du navigateur pour l'enregistrer en PDF.",
              "Printable preview produced by the server (legal mentions, lines and totals). It opens in a new tab; use your browser's print function to save it as a PDF.",
            )}
          </p>
          <div className="mp-barre-actions">
            <a
              href={`/api/factures/${encodeURIComponent(f.id)}/document`}
              target="_blank"
              rel="noopener noreferrer"
              className="mp-bouton mp-bouton--secondaire"
            >
              <Icone nom="oeil" />
              <span>{t("Ouvrir le document", "Open the document")}</span>
              <span className="mp-visuellement-cache">{t(" (nouvel onglet)", " (new tab)")}</span>
            </a>
            <LienFacturePdf
              factureId={f.id}
              contexte={designationFacture(f, langue).toLowerCase()}
            />
          </div>
        </div>
      </Carte>
      <ActionsFacture facture={f} actions={actions} />
      <CarteCommentaires
        entiteType="facture"
        entiteId={f.id}
        utilisateur={utilisateur}
        nomElement={t(
          `la facture ${designationFacture(f, langue)}`,
          `invoice ${designationFacture(f, langue)}`,
        )}
      />
    </div>
  );
}

function Bandeaux({
  f,
  raison,
  langue,
}: {
  f: FactureDetaillee;
  raison: string | null;
  langue: Langue;
}) {
  const t: Traduire = creerTraduire(langue);
  const approbateurs = langue === "en" ? ROLE_APPROBATEUR_LIBELLES_EN : ROLE_APPROBATEUR_LIBELLES;
  return (
    <>
      {f.statut === "brouillon" && f.motif_rejet ? (
        <Alerte
          tonalite="danger"
          annonce="aucune"
          titre={t("Facture rejetée lors de l'approbation", "Invoice rejected during approval")}
        >
          <p>{t(`Motif : ${f.motif_rejet}`, `Reason: ${f.motif_rejet}`)}</p>
        </Alerte>
      ) : null}
      {f.statut === "a_approuver" ? (
        <Alerte
          tonalite="attention"
          annonce="aucune"
          titre={t("En attente d'approbation", "Pending approval")}
        >
          <p>
            {t(
              `Approbation par ${approbateurs[f.role_approbateur ?? "associe"]} (seuil calculé sur le montant).`,
              `Approval by ${approbateurs[f.role_approbateur ?? "associe"]} (threshold computed on the amount).`,
            )}
            {raison ? ` ${raison}` : ""}
          </p>
        </Alerte>
      ) : null}
      {f.statut === "annulee" ? (
        <Alerte
          tonalite="info"
          annonce="aucune"
          titre={t("Facture annulée par un avoir", "Invoice cancelled by a credit note")}
        >
          <p>
            {f.annulee_par_avoir_id ? (
              <Link href={`/facturation/${f.annulee_par_avoir_id}`}>
                {t("Voir l'avoir", "View the credit note")}
              </Link>
            ) : null}
          </p>
        </Alerte>
      ) : null}
    </>
  );
}

function Informations({ f, langue }: { f: FactureDetaillee; langue: Langue }) {
  const t: Traduire = creerTraduire(langue);
  return (
    <dl className="mp-liste-def">
      <div>
        <dt>{t("Nature", "Type")}</dt>
        <dd>{libelleNature(f.nature, langue)}</dd>
      </div>
      <div>
        <dt>{t("Numéro", "Number")}</dt>
        <dd>{f.numero ?? t("Attribué à l'émission", "Assigned at issuance")}</dd>
      </div>
      <div>
        <dt>{t("Objet", "Subject")}</dt>
        <dd>{f.objet ?? "—"}</dd>
      </div>
      {f.motif ? (
        <div>
          <dt>{t("Motif", "Reason")}</dt>
          <dd>{f.motif}</dd>
        </div>
      ) : null}
      <div>
        <dt>{t("Mission", "Engagement")}</dt>
        <dd>
          <Link href={`/missions/${f.mission_id}/facturation`}>{f.mission_intitule}</Link>
        </dd>
      </div>
      {f.facture_origine_id ? (
        <div>
          <dt>{t("Facture d'origine", "Original invoice")}</dt>
          <dd>
            <Link href={`/facturation/${f.facture_origine_id}`}>
              {t("Voir la facture annulée", "View the cancelled invoice")}
            </Link>
          </dd>
        </div>
      ) : null}
      <div>
        <dt>{t("Émission", "Issued")}</dt>
        <dd>
          {f.date_emission
            ? formaterDate(f.date_emission, "UTC", langue)
            : t("Non émise", "Not issued")}
        </dd>
      </div>
      <div>
        <dt>{t("Échéance de paiement", "Payment due date")}</dt>
        <dd>
          {f.nature === "avoir"
            ? t("Sans objet (avoir)", "Not applicable (credit note)")
            : f.date_echeance
              ? formaterDate(f.date_echeance, "UTC", langue)
              : t(
                  `${f.delai_paiement_jours} jours après l'émission`,
                  `${f.delai_paiement_jours} days after issuance`,
                )}
        </dd>
      </div>
      {f.envoyee_le ? (
        <div>
          <dt>{t("Marquée envoyée le", "Marked as sent on")}</dt>
          <dd>{formaterDateHeure(f.envoyee_le, undefined, langue)}</dd>
        </div>
      ) : null}
    </dl>
  );
}
