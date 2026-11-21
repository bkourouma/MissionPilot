import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { creerTraduire } from "@missionpilot/shared";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  actionsEncaissement,
  etatEncaissement,
  libelleMoyen,
  libelleOrigineImputation,
  libelleStatutContrePassation,
  peutDeciderContrePassation,
  STATUT_CONTRE_PASSATION,
  type ContrePassation,
  type EncaissementDetaille,
} from "../../../../../lib/encaissements";
import {
  formaterDate,
  formaterDateHeure,
  formaterMontantMineur,
  libelleDevise,
} from "../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { exigerPermission } from "../../../../../lib/session";
import { DemandeContrePassation } from "../ContrePassations";
import { ActionsEncaissement } from "./ActionsEncaissement";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Encaissement", "Payment received") };
}

export default async function PageEncaissement({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const langue = await obtenirLangue();
  const t = creerTraduire(langue);
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("encaissement.gerer");
  const [r, demandes] = await Promise.all([
    chargerServeur<EncaissementDetaille>(`/api/finance/encaissements/${id}`),
    chargerServeur<{ elements: ContrePassation[] }>("/api/finance/contre-passations?limite=100"),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  const retour = {
    href: "/facturation/encaissements",
    libelle: t("Encaissements", "Payments received"),
  };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre={t("Encaissement", "Payment received")} retour={retour} />
        <EtatErreur
          titre={t("L'encaissement n'a pas pu être chargé.", "The payment could not be loaded.")}
          message={r.message}
          hrefReessayer={`/facturation/encaissements/${id}`}
        />
      </div>
    );
  }
  const e = r.donnees;
  const siennes = demandes.ok
    ? demandes.donnees.elements.filter((d) => d.encaissement_id === e.id)
    : [];
  const enAttente = siennes.find((d) => d.statut === "demandee") ?? null;
  const actions = actionsEncaissement(e, enAttente !== null);
  const etat = etatEncaissement(e, langue);
  const cle = `${e.non_impute}-${e.imputations.length}-${e.contre_passe_par}-${siennes.map((d) => d.statut).join()}`;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t(
          `${e.montant < 0 ? "Contre-passation" : "Encaissement"} du ${formaterDate(e.date_encaissement)}`,
          `${e.montant < 0 ? "Reversal" : "Payment"} of ${formaterDate(e.date_encaissement, "UTC", langue)}`,
        )}
        retour={retour}
        soustitre={`${e.client_raison_sociale} · ${libelleMoyen(e, langue)} · ${libelleDevise(e.devise)}`}
        badges={<BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>}
      />
      {e.contre_passation_de ? (
        <Alerte
          tonalite="info"
          annonce="aucune"
          titre={t("Écriture de contre-passation", "Reversal entry")}
        >
          <p>
            {e.motif ? t(`Motif : ${e.motif}. `, `Reason: ${e.motif}. `) : ""}
            <Link href={`/facturation/encaissements/${e.contre_passation_de}`}>
              {t("Voir l'encaissement annulé", "View the cancelled payment")}
            </Link>
          </p>
        </Alerte>
      ) : null}
      {e.contre_passe_par ? (
        <Alerte
          tonalite="attention"
          annonce="aucune"
          titre={t("Encaissement contre-passé", "Reversed payment")}
        >
          <p>
            {t(
              "Ses imputations ont été annulées par une écriture négative.",
              "Its allocations were cancelled by a negative entry.",
            )}{" "}
            <Link href={`/facturation/encaissements/${e.contre_passe_par}`}>
              {t("Voir la contre-passation", "View the reversal")}
            </Link>
          </p>
        </Alerte>
      ) : null}
      <Carte titre={t("Informations", "Information")}>
        <dl className="mp-liste-def">
          <div>
            <dt>{t("Montant", "Amount")}</dt>
            <dd className="mp-montant">{formaterMontantMineur(e.montant, e.devise, langue)}</dd>
          </div>
          <div>
            <dt>{t("Part non imputée (avance)", "Unallocated part (advance)")}</dt>
            <dd className="mp-montant">{formaterMontantMineur(e.non_impute, e.devise, langue)}</dd>
          </div>
          <div>
            <dt>{t("Référence", "Reference")}</dt>
            <dd>{e.reference ?? "—"}</dd>
          </div>
          <div>
            <dt>{t("Saisi le", "Entered on")}</dt>
            <dd>{formaterDateHeure(e.saisi_le, undefined, langue)}</dd>
          </div>
          {e.commentaire ? (
            <div>
              <dt>{t("Commentaire", "Comment")}</dt>
              <dd>{e.commentaire}</dd>
            </div>
          ) : null}
        </dl>
      </Carte>
      <Carte titre={t("Imputations", "Allocations")}>
        <div className="mp-chiffres">
          <Tableau
            legende={t(
              "Imputations de l'encaissement sur les factures",
              "Allocations of the payment to invoices",
            )}
            lignes={e.imputations}
            cleLigne={(i) => i.id}
            messageVide={t(
              "Aucune imputation : tout l'encaissement est une avance.",
              "No allocation: the whole payment is an advance.",
            )}
            colonnes={[
              {
                cle: "facture",
                entete: t("Facture", "Invoice"),
                rendu: (i) => (
                  <Link href={`/facturation/${i.facture_id}`}>
                    {i.facture_numero ?? t("Facture", "Invoice")}
                  </Link>
                ),
              },
              {
                cle: "date",
                entete: t("Date", "Date"),
                rendu: (i) => formaterDate(i.date_imputation, "UTC", langue),
              },
              {
                cle: "origine",
                entete: t("Origine", "Origin"),
                rendu: (i) => libelleOrigineImputation(i.origine, langue),
              },
              {
                cle: "montant",
                entete: t("Montant", "Amount"),
                alignement: "droite",
                rendu: (i) => (
                  <span className="mp-montant">
                    {formaterMontantMineur(i.montant, i.devise, langue)}
                  </span>
                ),
              },
            ]}
          />
        </div>
      </Carte>
      {siennes.length > 0 ? (
        <Carte titre={t("Contre-passation", "Reversal")}>
          <ul className="mp-liste-lignes">
            {siennes.map((d) =>
              d.statut === "demandee" ? (
                <li key={d.id} className="mp-liste-lignes__ligne">
                  <DemandeContrePassation
                    demande={d}
                    deMoi={d.demandee_par === utilisateur.id}
                    peutDecider={peutDeciderContrePassation(d, utilisateur.id, utilisateur.roles)}
                  />
                </li>
              ) : (
                <li key={d.id} className="mp-liste-lignes__ligne">
                  <div className="mp-liste-lignes__texte">
                    <p>
                      <BadgeStatut tonalite={STATUT_CONTRE_PASSATION[d.statut].tonalite}>
                        {libelleStatutContrePassation(d.statut, langue)}
                      </BadgeStatut>{" "}
                      {t(`Motif : ${d.motif}`, `Reason: ${d.motif}`)}
                    </p>
                    {d.motif_rejet ? (
                      <p>
                        {t(
                          `Motif du rejet : ${d.motif_rejet}`,
                          `Reason for rejection: ${d.motif_rejet}`,
                        )}
                      </p>
                    ) : null}
                    <p className="mp-texte-doux mp-texte-petit">
                      {t(
                        `Demandée le ${formaterDateHeure(d.demandee_le)}${d.decidee_le ? `, décidée le ${formaterDateHeure(d.decidee_le)}` : ""}`,
                        `Requested on ${formaterDateHeure(d.demandee_le, undefined, langue)}${d.decidee_le ? `, decided on ${formaterDateHeure(d.decidee_le, undefined, langue)}` : ""}`,
                      )}
                    </p>
                  </div>
                </li>
              ),
            )}
          </ul>
        </Carte>
      ) : null}
      <ActionsEncaissement
        encaissement={{ id: e.id, client_id: e.client_id, devise: e.devise }}
        actions={actions}
        cle={cle}
      />
    </div>
  );
}
