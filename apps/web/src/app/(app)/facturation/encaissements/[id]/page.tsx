import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
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
  ORIGINE_IMPUTATION,
  peutDeciderContrePassation,
  STATUT_CONTRE_PASSATION,
  type ContrePassation,
  type EncaissementDetaille,
} from "../../../../../lib/encaissements";
import { formaterDate, formaterDateHeure, formaterMontantMineur } from "../../../../../lib/format";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { exigerPermission } from "../../../../../lib/session";
import { DemandeContrePassation } from "../ContrePassations";
import { ActionsEncaissement } from "./ActionsEncaissement";

export const metadata: Metadata = { title: "Encaissement" };

export default async function PageEncaissement({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerPermission("encaissement.gerer");
  const [r, demandes] = await Promise.all([
    chargerServeur<EncaissementDetaille>(`/api/finance/encaissements/${id}`),
    chargerServeur<{ elements: ContrePassation[] }>("/api/finance/contre-passations?limite=100"),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  const retour = { href: "/facturation/encaissements", libelle: "Encaissements" };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Encaissement" retour={retour} />
        <EtatErreur
          titre="L'encaissement n'a pas pu être chargé."
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
  const etat = etatEncaissement(e);
  const cle = `${e.non_impute}-${e.imputations.length}-${e.contre_passe_par}-${siennes.map((d) => d.statut).join()}`;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={`${e.montant < 0 ? "Contre-passation" : "Encaissement"} du ${formaterDate(e.date_encaissement)}`}
        retour={retour}
        soustitre={`${e.client_raison_sociale} · ${libelleMoyen(e)} · ${e.devise}`}
        badges={<BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>}
      />
      {e.contre_passation_de ? (
        <Alerte tonalite="info" annonce="aucune" titre="Écriture de contre-passation">
          <p>
            {e.motif ? `Motif : ${e.motif}. ` : ""}
            <Link href={`/facturation/encaissements/${e.contre_passation_de}`}>
              Voir l&apos;encaissement annulé
            </Link>
          </p>
        </Alerte>
      ) : null}
      {e.contre_passe_par ? (
        <Alerte tonalite="attention" annonce="aucune" titre="Encaissement contre-passé">
          <p>
            Ses imputations ont été annulées par une écriture négative.{" "}
            <Link href={`/facturation/encaissements/${e.contre_passe_par}`}>
              Voir la contre-passation
            </Link>
          </p>
        </Alerte>
      ) : null}
      <Carte titre="Informations">
        <dl className="mp-liste-def">
          <div>
            <dt>Montant</dt>
            <dd className="mp-montant">{formaterMontantMineur(e.montant, e.devise)}</dd>
          </div>
          <div>
            <dt>Part non imputée (avance)</dt>
            <dd className="mp-montant">{formaterMontantMineur(e.non_impute, e.devise)}</dd>
          </div>
          <div>
            <dt>Référence</dt>
            <dd>{e.reference ?? "—"}</dd>
          </div>
          <div>
            <dt>Saisi le</dt>
            <dd>{formaterDateHeure(e.saisi_le)}</dd>
          </div>
          {e.commentaire ? (
            <div>
              <dt>Commentaire</dt>
              <dd>{e.commentaire}</dd>
            </div>
          ) : null}
        </dl>
      </Carte>
      <Carte titre="Imputations">
        <Tableau
          legende="Imputations de l'encaissement sur les factures"
          lignes={e.imputations}
          cleLigne={(i) => i.id}
          messageVide="Aucune imputation : tout l'encaissement est une avance."
          colonnes={[
            {
              cle: "facture",
              entete: "Facture",
              rendu: (i) => (
                <Link href={`/facturation/${i.facture_id}`}>{i.facture_numero ?? "Facture"}</Link>
              ),
            },
            { cle: "date", entete: "Date", rendu: (i) => formaterDate(i.date_imputation) },
            { cle: "origine", entete: "Origine", rendu: (i) => ORIGINE_IMPUTATION[i.origine] },
            {
              cle: "montant",
              entete: "Montant",
              alignement: "droite",
              rendu: (i) => (
                <span className="mp-montant">{formaterMontantMineur(i.montant, i.devise)}</span>
              ),
            },
          ]}
        />
      </Carte>
      {siennes.length > 0 ? (
        <Carte titre="Contre-passation">
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
                        {STATUT_CONTRE_PASSATION[d.statut].libelle}
                      </BadgeStatut>{" "}
                      {`Motif : ${d.motif}`}
                    </p>
                    {d.motif_rejet ? <p>{`Motif du rejet : ${d.motif_rejet}`}</p> : null}
                    <p className="mp-texte-doux mp-texte-petit">
                      {`Demandée le ${formaterDateHeure(d.demandee_le)}${d.decidee_le ? `, décidée le ${formaterDateHeure(d.decidee_le)}` : ""}`}
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
