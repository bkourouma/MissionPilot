import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NonDisponible } from "../../../../../components/portail/NonDisponible";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../components/ui/Icone";
import { formaterDate } from "../../../../../lib/format";
import {
  designationFacturePortail,
  estIdentifiant,
  etatPaiement,
  hrefDocumentFacture,
  montantPortail,
  peut,
  type FacturePortail,
} from "../../../../../lib/portail";
import { CHEMIN_PORTAIL } from "../../../../../lib/portail-routes";
import { chargerPortail, obtenirSessionPortail } from "../../../../../lib/portail-serveur";

export const metadata: Metadata = { title: "Facture" };

const CHEMIN_FACTURES = `${CHEMIN_PORTAIL}/factures`;

function Totaux({ f }: { f: FacturePortail }) {
  const m = (v: number) => montantPortail(v, f.devise);
  return (
    <dl className="mp-totaux-facture">
      <div>
        <dt>Total hors taxes</dt>
        <dd>{m(f.total_ht)}</dd>
      </div>
      <div>
        <dt>TVA</dt>
        <dd>{m(f.total_tva)}</dd>
      </div>
      <div className="mp-totaux-facture__fort">
        <dt>Total toutes taxes comprises</dt>
        <dd>{m(f.total_ttc)}</dd>
      </div>
      {f.total_retenues !== 0 ? (
        <div>
          <dt>Retenues déduites</dt>
          <dd>{m(f.total_retenues)}</dd>
        </div>
      ) : null}
      <div className="mp-totaux-facture__net">
        <dt>{f.nature === "avoir" ? "Montant de l'avoir" : "Net à payer"}</dt>
        <dd>{m(f.net_a_payer)}</dd>
      </div>
    </dl>
  );
}

function Paiement({ f }: { f: FacturePortail }) {
  if (!f.paiement) return null;
  const m = (v: number) => montantPortail(v, f.devise);
  return (
    <dl className="mp-portail-paiement">
      <div>
        <dt>Déjà réglé</dt>
        <dd>{m(f.paiement.encaisse)}</dd>
      </div>
      <div>
        <dt>Reste à payer</dt>
        <dd>{m(f.paiement.solde)}</dd>
      </div>
    </dl>
  );
}

/** Détail d'une facture émise : totaux, paiement et document imprimable. */
export default async function FacturePortailPage({ params }: { params: Promise<{ id: string }> }) {
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.factures.lire")) return <NonDisponible titre="Facture" />;
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();

  const r = await chargerPortail<FacturePortail>(`/api/portail/factures/${encodeURIComponent(id)}`);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Facture" retour={{ href: CHEMIN_FACTURES, libelle: "Vos factures" }} />
        <EtatErreur
          titre="Cette facture n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={`${CHEMIN_FACTURES}/${id}`}
        />
      </div>
    );
  }

  const f = r.donnees;
  const paiement = etatPaiement(f);
  const missionVisible = peut(utilisateur.roles, "portail.missions.lire");

  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={designationFacturePortail(f)}
        retour={{ href: CHEMIN_FACTURES, libelle: "Vos factures" }}
        badges={<BadgeStatut tonalite={paiement.tonalite}>{paiement.libelle}</BadgeStatut>}
        soustitre={f.objet ?? undefined}
        actions={
          <a
            href={hrefDocumentFacture(f.id)}
            target="_blank"
            rel="noopener noreferrer"
            className={classesBouton("primaire")}
          >
            <Icone nom="oeil" />
            <span>Afficher la facture</span>
            <span className="mp-visuellement-cache"> (nouvel onglet)</span>
          </a>
        }
      />

      <Carte titre="Informations">
        <dl className="mp-liste-def mp-liste-def--compacte">
          <div>
            <dt>Mission</dt>
            <dd>
              {missionVisible ? (
                <Link href={`${CHEMIN_PORTAIL}/missions/${encodeURIComponent(f.mission.id)}`}>
                  {f.mission.intitule}
                </Link>
              ) : (
                f.mission.intitule
              )}
            </dd>
          </div>
          <div>
            <dt>Date d&apos;émission</dt>
            <dd>{formaterDate(f.date_emission)}</dd>
          </div>
          {f.date_echeance ? (
            <div>
              <dt>Date d&apos;échéance</dt>
              <dd>{formaterDate(f.date_echeance)}</dd>
            </div>
          ) : null}
          {f.nature === "avoir" && f.facture_origine_id ? (
            <div>
              <dt>Facture concernée</dt>
              <dd>
                <Link href={`${CHEMIN_FACTURES}/${encodeURIComponent(f.facture_origine_id)}`}>
                  Voir la facture annulée par cet avoir
                </Link>
              </dd>
            </div>
          ) : null}
        </dl>
      </Carte>

      <Carte titre="Montants">
        <Totaux f={f} />
      </Carte>

      {f.paiement ? (
        <Carte titre="Paiement">
          <Paiement f={f} />
          <p className="mp-portail-note">
            Le suivi des règlements est tenu par votre cabinet. Un paiement récent peut mettre
            quelques jours à apparaître.
          </p>
        </Carte>
      ) : null}

      <p className="mp-portail-note">
        Le document de la facture s&apos;ouvre dans un nouvel onglet : vous pouvez l&apos;imprimer
        ou l&apos;enregistrer en PDF depuis votre navigateur.
      </p>
    </div>
  );
}
