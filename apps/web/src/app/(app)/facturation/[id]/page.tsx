import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { CarteCommentaires } from "../../../../components/collaboration/CarteCommentaires";
import { BadgePaiement } from "../../../../components/finance/BadgePaiement";
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
  NATURE_LIBELLES,
  ROLE_APPROBATEUR_LIBELLES,
  STATUT_FACTURE,
  type FactureDetaillee,
} from "../../../../lib/factures";
import { formaterDate, formaterDateHeure } from "../../../../lib/format";
import { estIdentifiant } from "../../../../lib/identifiant";
import type { MissionDetaillee } from "../../../../lib/missions";
import type { ParametresFacturation } from "../../../../lib/parametres-facturation";
import { exigerPermission } from "../../../../lib/session";
import type { PaiementFacture as Paiement } from "../../../../lib/encaissements";
import { ActionsFacture } from "./ActionsFacture";
import { PaiementFacture } from "./PaiementFacture";
import { LignesFacture, TotauxFacture } from "./ContenuFacture";

export const metadata: Metadata = { title: "Facture" };

export default async function PageFacture({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("facture.lire");
  const roles = utilisateur.roles;
  const r = await chargerServeur<FactureDetaillee>(`/api/factures/${id}`);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Facture" retour={{ href: "/facturation", libelle: "Facturation" }} />
        <EtatErreur
          titre="La facture n'a pas pu être chargée."
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
  const actions = actionsFacture(f, {
    roles,
    utilisateurId: utilisateur.id,
    directeurId: mission.ok ? mission.donnees.directeur_id : null,
  });
  const statut = STATUT_FACTURE[f.statut];
  const tauxAutorises = parametres?.ok
    ? parametres.donnees.taux_tva_autorises
    : [f.lignes[0]?.taux_tva ?? 0];

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={designationFacture(f)}
        retour={{ href: "/facturation", libelle: "Facturation" }}
        badges={
          <>
            <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
            {f.envoyee_le ? <BadgeStatut tonalite="succes">Envoyée</BadgeStatut> : null}
            {paiement?.ok && paiement.donnees.statut_paiement ? (
              <BadgePaiement
                statut={paiement.donnees.statut_paiement}
                joursRetard={paiement.donnees.jours_retard}
              />
            ) : null}
          </>
        }
        soustitre={`${f.client_raison_sociale} · ${f.mission_intitule} · ${f.devise}`}
      />
      <Bandeaux f={f} raison={actions.raisonRefusApprobation} />
      <Carte titre="Informations">
        <Informations f={f} />
      </Carte>
      <Carte titre="Lignes">
        <LignesFacture facture={f} modifiable={actions.modifier} tauxAutorises={tauxAutorises} />
      </Carte>
      <Carte titre="Totaux">
        <TotauxFacture facture={f} />
      </Carte>
      {paiement?.ok ? (
        <PaiementFacture
          paiement={paiement.donnees}
          devise={f.devise}
          gererEncaissements={aPermission(roles, "encaissement.gerer")}
        />
      ) : null}
      <Carte titre="Document">
        <div className="mp-pile">
          <p className="mp-texte-doux">
            Aperçu imprimable produit par le serveur (mentions légales, lignes et totaux). Il
            s&apos;ouvre dans un nouvel onglet ; utilisez l&apos;impression du navigateur pour
            l&apos;enregistrer en PDF.
          </p>
          <div>
            <a
              href={`/api/factures/${encodeURIComponent(f.id)}/document`}
              target="_blank"
              rel="noopener noreferrer"
              className="mp-bouton mp-bouton--secondaire"
            >
              <Icone nom="oeil" />
              <span>Ouvrir le document</span>
              <span className="mp-visuellement-cache"> (nouvel onglet)</span>
            </a>
          </div>
        </div>
      </Carte>
      <ActionsFacture facture={f} actions={actions} />
      <CarteCommentaires
        entiteType="facture"
        entiteId={f.id}
        utilisateur={utilisateur}
        nomElement={`la facture ${designationFacture(f)}`}
      />
    </div>
  );
}

function Bandeaux({ f, raison }: { f: FactureDetaillee; raison: string | null }) {
  return (
    <>
      {f.statut === "brouillon" && f.motif_rejet ? (
        <Alerte tonalite="danger" annonce="aucune" titre="Facture rejetée lors de l'approbation">
          <p>{`Motif : ${f.motif_rejet}`}</p>
        </Alerte>
      ) : null}
      {f.statut === "a_approuver" ? (
        <Alerte tonalite="attention" annonce="aucune" titre="En attente d'approbation">
          <p>
            {`Approbation par ${ROLE_APPROBATEUR_LIBELLES[f.role_approbateur ?? "associe"]} (seuil calculé sur le montant).`}
            {raison ? ` ${raison}` : ""}
          </p>
        </Alerte>
      ) : null}
      {f.statut === "annulee" ? (
        <Alerte tonalite="info" annonce="aucune" titre="Facture annulée par un avoir">
          <p>
            {f.annulee_par_avoir_id ? (
              <Link href={`/facturation/${f.annulee_par_avoir_id}`}>Voir l&apos;avoir</Link>
            ) : null}
          </p>
        </Alerte>
      ) : null}
    </>
  );
}

function Informations({ f }: { f: FactureDetaillee }) {
  return (
    <dl className="mp-liste-def">
      <div>
        <dt>Nature</dt>
        <dd>{NATURE_LIBELLES[f.nature]}</dd>
      </div>
      <div>
        <dt>Numéro</dt>
        <dd>{f.numero ?? "Attribué à l'émission"}</dd>
      </div>
      <div>
        <dt>Objet</dt>
        <dd>{f.objet ?? "—"}</dd>
      </div>
      {f.motif ? (
        <div>
          <dt>Motif</dt>
          <dd>{f.motif}</dd>
        </div>
      ) : null}
      <div>
        <dt>Mission</dt>
        <dd>
          <Link href={`/missions/${f.mission_id}/facturation`}>{f.mission_intitule}</Link>
        </dd>
      </div>
      {f.facture_origine_id ? (
        <div>
          <dt>Facture d&apos;origine</dt>
          <dd>
            <Link href={`/facturation/${f.facture_origine_id}`}>Voir la facture annulée</Link>
          </dd>
        </div>
      ) : null}
      <div>
        <dt>Émission</dt>
        <dd>{f.date_emission ? formaterDate(f.date_emission) : "Non émise"}</dd>
      </div>
      <div>
        <dt>Échéance de paiement</dt>
        <dd>
          {f.nature === "avoir"
            ? "Sans objet (avoir)"
            : f.date_echeance
              ? formaterDate(f.date_echeance)
              : `${f.delai_paiement_jours} jours après l'émission`}
        </dd>
      </div>
      {f.envoyee_le ? (
        <div>
          <dt>Marquée envoyée le</dt>
          <dd>{formaterDateHeure(f.envoyee_le)}</dd>
        </div>
      ) : null}
    </dl>
  );
}
