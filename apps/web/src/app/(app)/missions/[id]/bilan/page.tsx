import type { Metadata } from "next";
import Link from "next/link";
import { creerTraduire, type Langue } from "@missionpilot/shared";
import { BoutonOuvrirRetour } from "../../../../../components/connaissances/FormulairesConnaissances";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { retourModifiable, type Bilan, type FinanceBilan } from "../../../../../lib/bilan";
import { hrefRetour, peutOuvrirRetour, type RetourDetail } from "../../../../../lib/capitalisation";
import {
  formaterDate,
  formaterDateHeure,
  formaterJours,
  formaterMontantMineur,
  formaterPourcentage,
  type Devise,
  libelleDevise,
} from "../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { formaterEcartJours, statutEcart, statutMarge } from "../../../../../lib/indicateurs";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../lib/session";
import { RetourExperience } from "./RetourExperience";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Bilan de clôture", "Close-out review") };
}

function Total({ libelle, valeur }: { libelle: string; valeur: string }) {
  return (
    <li className="mp-totaux__element">
      <span className="mp-totaux__libelle">{libelle}</span>
      <span className="mp-totaux__valeur">{valeur}</span>
    </li>
  );
}

export default async function PageBilan({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await exigerPermission("mission.lire");
  const m = await chargerMission(id);
  if (!m.ok) return null;
  if (m.donnees.statut !== "cloturee") {
    return (
      <EtatVide titre={t("Pas encore de bilan.", "No review yet.")} icone="cadenas">
        <p>
          {t(
            "Le bilan de clôture est établi et figé au moment de la clôture de la mission.",
            "The close-out review is drawn up and locked when the engagement is closed.",
          )}
        </p>
      </EtatVide>
    );
  }
  const r = await chargerServeur<Bilan>(`/api/missions/${m.donnees.id}/bilan`);
  if (!r.ok) {
    return r.statut === 404 ? (
      <EtatVide
        titre={t(
          "Aucun bilan enregistré pour cette mission.",
          "No review recorded for this engagement.",
        )}
        icone="info"
      >
        <p>
          {t(
            "La mission a été clôturée avant la mise en place des bilans de clôture.",
            "The engagement was closed before close-out reviews were introduced.",
          )}
        </p>
      </EtatVide>
    ) : (
      <EtatErreur
        titre={t("Le bilan n'a pas pu être chargé.", "The review could not be loaded.")}
        message={r.message}
        hrefReessayer={`/missions/${id}/bilan`}
      />
    );
  }
  const b = r.donnees;
  const j = b.jours;
  const ecart = statutEcart(j.ecart_relatif, j.ecart_realise, langue);
  // Retour d'expérience structuré (CAP-01) : lecture seule si le droit manque (pas d'encart).
  const structure = await chargerServeur<{ retour: RetourDetail | null }>(
    `/api/capitalisation/missions/${m.donnees.id}/retour`,
  );
  const droit = retourModifiable(
    b,
    {
      utilisateurId: utilisateur.id,
      roles: utilisateur.roles,
      directeurId: m.donnees.directeur_id,
      maintenant: new Date(),
    },
    langue,
  );

  return (
    <div className="mp-pile mp-pile--large">
      <p className="mp-texte-doux">
        {t(
          `Bilan figé à la clôture du ${formaterDate(b.date_cloture)} : il ne change plus, même si des temps ou des factures sont corrigés ensuite.`,
          `Review locked at close-out on ${formaterDate(b.date_cloture, "UTC", "en")}: it no longer changes, even if time entries or invoices are corrected afterwards.`,
        )}
      </p>
      <Carte
        titre={t("Jours", "Days")}
        actions={<BadgeStatut tonalite={ecart.tonalite}>{ecart.libelle}</BadgeStatut>}
      >
        <ul className="mp-totaux">
          <Total libelle={t("Budget", "Budget")} valeur={formaterJours(j.budget, langue)} />
          <Total libelle={t("Réalisé", "Actual")} valeur={formaterJours(j.realise, langue)} />
          <Total
            libelle={t("Écart budget / réalisé", "Budget / actual variance")}
            valeur={formaterEcartJours(j.ecart_realise, j.ecart_relatif, langue)}
          />
          <Total
            libelle={t("Atterrissage", "Landing")}
            valeur={formaterJours(j.atterrissage, langue)}
          />
          <Total
            libelle={t("Consommation", "Consumption")}
            valeur={formaterPourcentage(j.consommation, 1, langue)}
          />
        </ul>
      </Carte>
      {b.finance ? (
        <BlocFinance f={b.finance} langue={langue} />
      ) : (
        <Alerte
          tonalite="info"
          annonce="aucune"
          titre={t("Montants et marge non affichés", "Amounts and margin not shown")}
        >
          <p>
            {t(
              "Les montants, coûts et marges du bilan sont réservés aux associés et gestionnaires.",
              "The amounts, costs and margins of the review are reserved for partners and managers.",
            )}
          </p>
        </Alerte>
      )}
      {b.atterrissage?.synthese && b.devise ? (
        <Carte titre={t("Version d'atterrissage", "Landing version")}>
          <ul className="mp-totaux">
            <Total
              libelle={t("Jours vendus", "Days sold")}
              valeur={formaterJours(b.atterrissage.synthese.jours_vendus, langue)}
            />
            {b.atterrissage.synthese.honoraires !== undefined ? (
              <Total
                libelle={t("Honoraires", "Fees")}
                valeur={formaterMontantMineur(b.atterrissage.synthese.honoraires, b.devise, langue)}
              />
            ) : null}
            {b.atterrissage.synthese.marge !== undefined ? (
              <Total
                libelle={t("Marge", "Margin")}
                valeur={`${formaterMontantMineur(b.atterrissage.synthese.marge, b.devise, langue)} (${formaterPourcentage(b.atterrissage.synthese.taux_marge, 1, langue)})`}
              />
            ) : null}
          </ul>
        </Carte>
      ) : null}
      <Carte titre={t("Retour d'expérience", "Lessons learned")}>
        <div className="mp-pile">
          <p className="mp-texte-doux">
            {droit.modifiable
              ? t(
                  `Modifiable jusqu'au ${formaterDateHeure(b.retour_modifiable_jusqu_au)} par le directeur de la mission ou un associé.`,
                  `Editable until ${formaterDateHeure(b.retour_modifiable_jusqu_au, undefined, "en")} by the engagement director or a partner.`,
                )
              : t(
                  `Lecture seule. Date limite de rédaction : ${formaterDateHeure(b.retour_modifiable_jusqu_au)}.`,
                  `Read-only. Writing deadline: ${formaterDateHeure(b.retour_modifiable_jusqu_au, undefined, "en")}.`,
                )}
          </p>
          {b.retour_modifie_le ? (
            <p className="mp-texte-doux mp-texte-petit">
              {t(
                `Dernière modification le ${formaterDateHeure(b.retour_modifie_le)}.`,
                `Last modified on ${formaterDateHeure(b.retour_modifie_le, undefined, "en")}.`,
              )}
            </p>
          ) : null}
          <RetourExperience
            missionId={m.donnees.id}
            texte={b.retour_experience}
            modifiable={droit.modifiable}
            raison={droit.raison}
            cle={b.retour_modifie_le ?? ""}
          />
        </div>
      </Carte>
      {structure.ok ? (
        <Carte titre={t("Retour d'expérience structuré", "Structured lessons learned")}>
          <div className="mp-pile">
            <p className="mp-texte-doux">
              {t(
                "Le texte libre ci-dessus est la note de clôture de la mission. Le retour d'expérience structuré (contexte, méthode, écarts, leçons) a un brouillon construit depuis les données de la mission, est relu puis validé par le chef ou le directeur de la mission, et alimente la base de connaissances et la base d'estimation.",
                "The free text above is the engagement's close-out note. The structured lessons learned (context, method, variances, lessons) have a draft built from the engagement data, are reviewed and then approved by the engagement manager or director, and feed the knowledge base and the estimation base.",
              )}
            </p>
            {structure.donnees.retour ? (
              <p>
                <Link
                  href={hrefRetour(structure.donnees.retour.id)}
                  className={classesBouton("secondaire")}
                >
                  {structure.donnees.retour.statut === "valide"
                    ? t("Voir le retour d'expérience validé", "View the approved lessons learned")
                    : t(
                        "Rédiger et valider le retour d'expérience",
                        "Write and approve the lessons learned",
                      )}
                </Link>
              </p>
            ) : peutOuvrirRetour(
                { roles: utilisateur.roles, utilisateurId: utilisateur.id },
                m.donnees,
              ) ? (
              <>
                <p className="mp-texte-doux mp-texte-petit">
                  {t(
                    "Il s'ouvre automatiquement à la clôture ; cette mission a été clôturée avant cette fonction : ouvrez-le ici.",
                    "It opens automatically at close-out; this engagement was closed before this feature existed: open it here.",
                  )}
                </p>
                <BoutonOuvrirRetour missionId={m.donnees.id} />
              </>
            ) : (
              <p className="mp-texte-doux mp-texte-petit">
                {t(
                  "Aucun retour d'expérience structuré n'est ouvert. Il s'ouvre depuis cet écran par le chef, le directeur de la mission ou un associé.",
                  "No structured lessons learned is open. It is opened from this screen by the engagement manager, the director or a partner.",
                )}
              </p>
            )}
          </div>
        </Carte>
      ) : null}
    </div>
  );
}

function BlocFinance({ f, langue }: { f: FinanceBilan; langue: Langue }) {
  const t = creerTraduire(langue);
  const d: Devise = f.devise;
  const m = (v: number | null | undefined) => formaterMontantMineur(v, d, langue);
  const marge = statutMarge(f.realise.taux_marge, f.realise.marge, langue);
  return (
    <Carte
      titre={`${t("Rentabilité", "Profitability")} (${libelleDevise(d)})`}
      actions={<BadgeStatut tonalite={marge.tonalite}>{marge.libelle}</BadgeStatut>}
    >
      <div className="mp-pile">
        <ul className="mp-totaux" aria-label={t("Réalisé", "Actual")}>
          <Total
            libelle={t("Honoraires facturés", "Fees invoiced")}
            valeur={m(f.realise.honoraires_factures)}
          />
          <Total
            libelle={t("Coûts internes", "Internal costs")}
            valeur={m(f.realise.couts_internes)}
          />
          <Total
            libelle={t("Sous-traitance", "Subcontracting")}
            valeur={m(f.realise.sous_traitance)}
          />
          <Total
            libelle={t("Débours non refacturés", "Non-rebilled expenses")}
            valeur={m(f.realise.debours_non_refactures)}
          />
          <Total
            libelle={t("Marge réalisée", "Actual margin")}
            valeur={`${m(f.realise.marge)} (${formaterPourcentage(f.realise.taux_marge, 1, langue)})`}
          />
          <Total
            libelle={t("Taux de réalisation", "Realization rate")}
            valeur={formaterPourcentage(f.taux_realisation, 1, langue)}
          />
        </ul>
        {f.budget ? (
          <ul className="mp-totaux" aria-label={t("Budget de référence", "Reference budget")}>
            <Total
              libelle={t("Honoraires budgétés", "Budgeted fees")}
              valeur={m(f.budget.honoraires)}
            />
            <Total
              libelle={t("Marge budgétée", "Budgeted margin")}
              valeur={`${m(f.budget.marge)} (${formaterPourcentage(f.budget.taux_marge, 1, langue)})`}
            />
            {f.ecart ? (
              <>
                <Total
                  libelle={t("Écart en coûts de production", "Production cost variance")}
                  valeur={m(f.ecart.couts_production)}
                />
                <Total libelle={t("Écart de marge", "Margin variance")} valeur={m(f.ecart.marge)} />
              </>
            ) : null}
          </ul>
        ) : null}
        <p className="mp-texte-doux">
          {t(
            `Encours à la clôture : ${m(f.encours.encours_production)} ; facturé d'avance : ${m(f.encours.facture_d_avance)}.`,
            `Work in progress at close-out: ${m(f.encours.encours_production)}; billed in advance: ${m(f.encours.facture_d_avance)}.`,
          )}
        </p>
      </div>
    </Carte>
  );
}
