import Link from "next/link";
import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { deboursRefacturables, type PageDebours } from "../../../../../lib/debours";
import type { Decoupage } from "../../../../../lib/decoupage";
import {
  echeancesFacturables,
  peutGererEcheancier,
  type Echeancier,
} from "../../../../../lib/echeancier";
import {
  designationFacture,
  factureVisible,
  STATUT_FACTURE,
  type Facture,
  type FactureDetaillee,
} from "../../../../../lib/factures";
import { BadgePaiement } from "../../../../../components/finance/BadgePaiement";
import { chargerPaiements } from "../../../../../lib/finance-serveur";
import { formaterDate, formaterJours, formaterMontantMineur } from "../../../../../lib/format";
import { encoursValorise, type ReponseEncoursMission } from "../../../../../lib/rentabilite";
import { estSignee } from "../../../../../lib/missions";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../lib/session";
import { CreationFacture } from "./CreationFacture";
import { EcheancierMission } from "./EcheancierMission";

export const metadata: Metadata = { title: "Facturation de la mission" };

interface PageFactures {
  elements: Facture[];
  curseur_suivant: string | null;
}

/**
 * Débours déjà rattachés à une facture en cours (non annulée) : la liste des débours ne le
 * dit pas, les lignes des factures de la mission oui.
 */
async function deboursDejaFactures(factures: readonly Facture[]): Promise<Set<string>> {
  const enCours = factures
    .filter((f) => f.nature === "facture" && f.statut !== "annulee")
    .slice(0, 20);
  const details = await Promise.all(
    enCours.map((f) => chargerServeur<FactureDetaillee>(`/api/factures/${f.id}`)),
  );
  const ids = new Set<string>();
  for (const d of details) {
    if (!d.ok) continue;
    for (const l of d.donnees.lignes) if (l.debours_id) ids.add(l.debours_id);
  }
  return ids;
}

export default async function PageFacturationMission({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("facture.lire");
  const roles = utilisateur.roles;
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  if (!estSignee(m.statut)) {
    return (
      <EtatVide titre="Pas encore d'échéancier." icone="cadenas">
        <p>
          L&apos;échéancier et les factures se construisent après la signature de la lettre de
          mission, qui fige le budget (onglet Fiche).
        </p>
      </EtatVide>
    );
  }
  const gerer = peutGererEcheancier(m, roles, utilisateur.id);
  const emettre = aPermission(roles, "facture.emettre");
  const [echeancier, decoupage, factures, debours, encours] = await Promise.all([
    chargerServeur<Echeancier>(`/api/missions/${m.id}/echeancier`),
    gerer ? chargerServeur<Decoupage>(`/api/missions/${m.id}/decoupage`) : Promise.resolve(null),
    chargerServeur<PageFactures>(`/api/factures?mission_id=${m.id}&limite=100`),
    emettre
      ? chargerServeur<PageDebours>(`/api/missions/${m.id}/debours?statut=valide&limite=100`)
      : Promise.resolve(null),
    chargerServeur<ReponseEncoursMission>(`/api/missions/${m.id}/encours`),
  ]);
  const listeFactures = factures.ok ? factures.donnees.elements.map(factureVisible) : [];
  const paiements = await chargerPaiements(listeFactures);
  const dejaFactures = emettre ? await deboursDejaFactures(listeFactures) : new Set<string>();
  const jalons = decoupage?.ok
    ? decoupage.donnees.jalons.map((j) => ({ valeur: j.id, libelle: j.libelle }))
    : [];

  return (
    <div className="mp-pile mp-pile--large">
      {!echeancier.ok ? (
        <EtatErreur
          titre="L'échéancier n'a pas pu être chargé."
          message={echeancier.message}
          hrefReessayer={`/missions/${m.id}/facturation`}
        />
      ) : (
        <EcheancierMission
          missionId={m.id}
          mode={m.mode_facturation}
          echeancier={echeancier.donnees}
          jalons={jalons}
          gerer={gerer}
        />
      )}

      {emettre && echeancier.ok ? (
        <Carte titre="Préparer une facture">
          <CreationFacture
            missionId={m.id}
            devise={m.devise}
            echeances={echeancesFacturables(echeancier.donnees.echeances)}
            debours={
              debours?.ok
                ? deboursRefacturables(debours.donnees.elements).filter(
                    (d) => !dejaFactures.has(d.id),
                  )
                : []
            }
          />
        </Carte>
      ) : null}

      <Carte titre="Factures et avoirs de la mission">
        {!factures.ok ? (
          <EtatErreur
            titre="Les factures n'ont pas pu être chargées."
            message={factures.message}
            hrefReessayer={`/missions/${m.id}/facturation`}
          />
        ) : listeFactures.length === 0 ? (
          <p className="mp-texte-doux">Aucune facture pour cette mission.</p>
        ) : (
          <ul className="mp-liste-lignes">
            {listeFactures.map((f) => (
              <li key={f.id} className="mp-liste-lignes__ligne">
                <span className="mp-liste-lignes__texte">
                  <Link href={`/facturation/${f.id}`}>
                    <strong>{designationFacture(f)}</strong>
                  </Link>
                  <span className="mp-texte-doux">
                    {f.date_emission
                      ? `Émise le ${formaterDate(f.date_emission)}`
                      : `Créée le ${formaterDate(f.cree_le, "Africa/Abidjan")}`}
                  </span>
                </span>
                <span className="mp-montant">{formaterMontantMineur(f.net_a_payer, f.devise)}</span>
                <BadgeStatut tonalite={STATUT_FACTURE[f.statut].tonalite}>
                  {STATUT_FACTURE[f.statut].libelle}
                </BadgeStatut>
                {paiements.get(f.id)?.statut_paiement ? (
                  <BadgePaiement
                    statut={paiements.get(f.id)?.statut_paiement ?? "non_payee"}
                    joursRetard={paiements.get(f.id)?.jours_retard}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Carte>
      {encours.ok ? <EncoursMissionCarte r={encours.donnees} /> : null}
    </div>
  );
}

/** Encours de production de la mission ; valorisation seulement si l'API la sert (finance.lire). */
function EncoursMissionCarte({ r }: { r: ReponseEncoursMission }) {
  if (!r.signee) return null;
  return (
    <Carte titre={`Encours de production au ${formaterDate(r.date)}`}>
      <ul className="mp-totaux">
        <li className="mp-totaux__element">
          <span className="mp-totaux__libelle">Jours validés</span>
          <span className="mp-totaux__valeur">{formaterJours(r.jours_valides)}</span>
        </li>
        {encoursValorise(r) && r.devise ? (
          <>
            <li className="mp-totaux__element">
              <span className="mp-totaux__libelle">Valeur produite</span>
              <span className="mp-totaux__valeur">
                {formaterMontantMineur(r.valeur_produite, r.devise)}
              </span>
            </li>
            <li className="mp-totaux__element">
              <span className="mp-totaux__libelle">Encours (non facturé)</span>
              <span className="mp-totaux__valeur">
                {formaterMontantMineur(r.encours_production, r.devise)}
              </span>
            </li>
            <li className="mp-totaux__element">
              <span className="mp-totaux__libelle">Facturé d&apos;avance</span>
              <span className="mp-totaux__valeur">
                {formaterMontantMineur(r.facture_d_avance, r.devise)}
              </span>
            </li>
          </>
        ) : null}
      </ul>
      {!encoursValorise(r) ? (
        <p className="mp-texte-doux">
          Valorisation de l&apos;encours réservée aux associés et gestionnaires.
        </p>
      ) : null}
    </Carte>
  );
}
