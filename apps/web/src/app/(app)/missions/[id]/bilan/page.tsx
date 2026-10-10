import type { Metadata } from "next";
import Link from "next/link";
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
} from "../../../../../lib/format";
import { formaterEcartJours, statutEcart, statutMarge } from "../../../../../lib/indicateurs";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../lib/session";
import { RetourExperience } from "./RetourExperience";

export const metadata: Metadata = { title: "Bilan de clôture" };

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
  const { utilisateur } = await exigerPermission("mission.lire");
  const m = await chargerMission(id);
  if (!m.ok) return null;
  if (m.donnees.statut !== "cloturee") {
    return (
      <EtatVide titre="Pas encore de bilan." icone="cadenas">
        <p>Le bilan de clôture est établi et figé au moment de la clôture de la mission.</p>
      </EtatVide>
    );
  }
  const r = await chargerServeur<Bilan>(`/api/missions/${m.donnees.id}/bilan`);
  if (!r.ok) {
    return r.statut === 404 ? (
      <EtatVide titre="Aucun bilan enregistré pour cette mission." icone="info">
        <p>La mission a été clôturée avant la mise en place des bilans de clôture.</p>
      </EtatVide>
    ) : (
      <EtatErreur
        titre="Le bilan n'a pas pu être chargé."
        message={r.message}
        hrefReessayer={`/missions/${id}/bilan`}
      />
    );
  }
  const b = r.donnees;
  const j = b.jours;
  const ecart = statutEcart(j.ecart_relatif, j.ecart_realise);
  // Retour d'expérience structuré (CAP-01) : lecture seule si le droit manque (pas d'encart).
  const structure = await chargerServeur<{ retour: RetourDetail | null }>(
    `/api/capitalisation/missions/${m.donnees.id}/retour`,
  );
  const droit = retourModifiable(b, {
    utilisateurId: utilisateur.id,
    roles: utilisateur.roles,
    directeurId: m.donnees.directeur_id,
    maintenant: new Date(),
  });

  return (
    <div className="mp-pile mp-pile--large">
      <p className="mp-texte-doux">
        {`Bilan figé à la clôture du ${formaterDate(b.date_cloture)} : il ne change plus, même si des temps ou des factures sont corrigés ensuite.`}
      </p>
      <Carte
        titre="Jours"
        actions={<BadgeStatut tonalite={ecart.tonalite}>{ecart.libelle}</BadgeStatut>}
      >
        <ul className="mp-totaux">
          <Total libelle="Budget" valeur={formaterJours(j.budget)} />
          <Total libelle="Réalisé" valeur={formaterJours(j.realise)} />
          <Total
            libelle="Écart budget / réalisé"
            valeur={formaterEcartJours(j.ecart_realise, j.ecart_relatif)}
          />
          <Total libelle="Atterrissage" valeur={formaterJours(j.atterrissage)} />
          <Total libelle="Consommation" valeur={formaterPourcentage(j.consommation)} />
        </ul>
      </Carte>
      {b.finance ? (
        <BlocFinance f={b.finance} />
      ) : (
        <Alerte tonalite="info" annonce="aucune" titre="Montants et marge non affichés">
          <p>Les montants, coûts et marges du bilan sont réservés aux associés et gestionnaires.</p>
        </Alerte>
      )}
      {b.atterrissage?.synthese && b.devise ? (
        <Carte titre="Version d'atterrissage">
          <ul className="mp-totaux">
            <Total
              libelle="Jours vendus"
              valeur={formaterJours(b.atterrissage.synthese.jours_vendus)}
            />
            {b.atterrissage.synthese.honoraires !== undefined ? (
              <Total
                libelle="Honoraires"
                valeur={formaterMontantMineur(b.atterrissage.synthese.honoraires, b.devise)}
              />
            ) : null}
            {b.atterrissage.synthese.marge !== undefined ? (
              <Total
                libelle="Marge"
                valeur={`${formaterMontantMineur(b.atterrissage.synthese.marge, b.devise)} (${formaterPourcentage(b.atterrissage.synthese.taux_marge)})`}
              />
            ) : null}
          </ul>
        </Carte>
      ) : null}
      <Carte titre="Retour d'expérience">
        <div className="mp-pile">
          <p className="mp-texte-doux">
            {droit.modifiable
              ? `Modifiable jusqu'au ${formaterDateHeure(b.retour_modifiable_jusqu_au)} par le directeur de la mission ou un associé.`
              : `Lecture seule. Date limite de rédaction : ${formaterDateHeure(b.retour_modifiable_jusqu_au)}.`}
          </p>
          {b.retour_modifie_le ? (
            <p className="mp-texte-doux mp-texte-petit">{`Dernière modification le ${formaterDateHeure(b.retour_modifie_le)}.`}</p>
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
        <Carte titre="Retour d'expérience structuré">
          <div className="mp-pile">
            <p className="mp-texte-doux">
              Le texte libre ci-dessus est la note de clôture de la mission. Le retour
              d&apos;expérience structuré (contexte, méthode, écarts, leçons) a un brouillon
              construit depuis les données de la mission, est relu puis validé par le chef ou le
              directeur de la mission, et alimente la base de connaissances et la base
              d&apos;estimation.
            </p>
            {structure.donnees.retour ? (
              <p>
                <Link
                  href={hrefRetour(structure.donnees.retour.id)}
                  className={classesBouton("secondaire")}
                >
                  {structure.donnees.retour.statut === "valide"
                    ? "Voir le retour d'expérience validé"
                    : "Rédiger et valider le retour d'expérience"}
                </Link>
              </p>
            ) : peutOuvrirRetour(
                { roles: utilisateur.roles, utilisateurId: utilisateur.id },
                m.donnees,
              ) ? (
              <>
                <p className="mp-texte-doux mp-texte-petit">
                  Il s&apos;ouvre automatiquement à la clôture ; cette mission a été clôturée avant
                  cette fonction : ouvrez-le ici.
                </p>
                <BoutonOuvrirRetour missionId={m.donnees.id} />
              </>
            ) : (
              <p className="mp-texte-doux mp-texte-petit">
                Aucun retour d&apos;expérience structuré n&apos;est ouvert. Il s&apos;ouvre depuis
                cet écran par le chef, le directeur de la mission ou un associé.
              </p>
            )}
          </div>
        </Carte>
      ) : null}
    </div>
  );
}

function BlocFinance({ f }: { f: FinanceBilan }) {
  const d: Devise = f.devise;
  const m = (v: number | null | undefined) => formaterMontantMineur(v, d);
  const marge = statutMarge(f.realise.taux_marge, f.realise.marge);
  return (
    <Carte
      titre={`Rentabilité (${d})`}
      actions={<BadgeStatut tonalite={marge.tonalite}>{marge.libelle}</BadgeStatut>}
    >
      <div className="mp-pile">
        <ul className="mp-totaux" aria-label="Réalisé">
          <Total libelle="Honoraires facturés" valeur={m(f.realise.honoraires_factures)} />
          <Total libelle="Coûts internes" valeur={m(f.realise.couts_internes)} />
          <Total libelle="Sous-traitance" valeur={m(f.realise.sous_traitance)} />
          <Total libelle="Débours non refacturés" valeur={m(f.realise.debours_non_refactures)} />
          <Total
            libelle="Marge réalisée"
            valeur={`${m(f.realise.marge)} (${formaterPourcentage(f.realise.taux_marge)})`}
          />
          <Total libelle="Taux de réalisation" valeur={formaterPourcentage(f.taux_realisation)} />
        </ul>
        {f.budget ? (
          <ul className="mp-totaux" aria-label="Budget de référence">
            <Total libelle="Honoraires budgétés" valeur={m(f.budget.honoraires)} />
            <Total
              libelle="Marge budgétée"
              valeur={`${m(f.budget.marge)} (${formaterPourcentage(f.budget.taux_marge)})`}
            />
            {f.ecart ? (
              <>
                <Total
                  libelle="Écart en coûts de production"
                  valeur={m(f.ecart.couts_production)}
                />
                <Total libelle="Écart de marge" valeur={m(f.ecart.marge)} />
              </>
            ) : null}
          </ul>
        ) : null}
        <p className="mp-texte-doux">
          {`Encours à la clôture : ${m(f.encours.encours_production)} ; facturé d'avance : ${m(f.encours.facture_d_avance)}.`}
        </p>
      </div>
    </Carte>
  );
}
