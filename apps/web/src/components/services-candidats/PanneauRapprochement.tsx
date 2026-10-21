"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Carte } from "../ui/Carte";
import { Champ } from "../ui/Champ";
import { Select, type OptionSelect } from "../ui/Select";
import { api } from "../../lib/api";
import { formaterDate, formaterNombre } from "../../lib/format";
import {
  compterParStatut,
  libelleCritere,
  libelleStatut,
  MENTION_GUICHETS_A_VALIDER,
  messageRapprochementTronque,
  OPTIONS_DEVISES_SERVICE,
  OPTIONS_OBJETS,
  SAISIE_RAPPROCHEMENT_VIDE,
  STATUT_RAPPROCHEMENT,
  TYPE_GUICHET_LIBELLES,
  validerRapprochement,
  VERDICT_LIBELLES,
  type ChampRapprochement,
  type ReponseRapprochement,
  type SaisieRapprochement,
} from "../../lib/services-candidats";

export interface PanneauRapprochementProps {
  clients: readonly OptionSelect[];
  /** Nombre de guichets saisis par le cabinet (aucun rapprochement possible à zéro). */
  nombreGuichets: number;
}

/** Rapprochement indicatif d'un client (ou d'un profil saisi) avec les guichets du cabinet. */
export function PanneauRapprochement({ clients, nombreGuichets }: PanneauRapprochementProps) {
  const f = useFormulaire<ChampRapprochement>();
  const [s, setS] = useState<SaisieRapprochement>(SAISIE_RAPPROCHEMENT_VIDE);
  const [reponse, setReponse] = useState<ReponseRapprochement | null>(null);
  const texte = (k: keyof SaisieRapprochement) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [k]: e.target.value }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerRapprochement(s),
      (charge) => api.post<ReponseRapprochement>("/api/guichets-financement/rapprochement", charge),
      { rafraichir: false, apres: setReponse },
    );
  }

  const comptes = reponse ? compterParStatut(reponse.resultats) : null;

  return (
    <Carte titre="Rapprochement" niveauTitre={2}>
      <div className="mp-pile">
        <p>
          Compare un client, ou un profil saisi, aux guichets de votre cabinet. Les champs
          renseignés ci-dessous remplacent ceux de la fiche du client.
        </p>
        <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
          <RetourFormulaire
            erreur={f.erreurGlobale}
            refAlerte={f.refAlerte}
            titreErreur="Rapprochement impossible"
          />
          <div className="mp-grille-champs">
            <Select
              libelle="Client"
              name="client_id"
              options={clients}
              invite="Aucun client (profil saisi)"
              value={s.client_id}
              onChange={texte("client_id")}
              erreur={f.erreurs.client_id}
              aide="Facultatif : pays, secteur, taille et filières viennent de son dossier."
            />
            <Champ
              libelle="Pays"
              name="pays"
              value={s.pays}
              onChange={texte("pays")}
              erreur={f.erreurs.pays}
            />
            <Champ
              libelle="Secteur"
              name="secteur"
              value={s.secteur}
              onChange={texte("secteur")}
              erreur={f.erreurs.secteur}
            />
            <Champ
              libelle="Filières"
              name="filieres"
              value={s.filieres}
              onChange={texte("filieres")}
              erreur={f.erreurs.filieres}
              aide="Séparées par des virgules."
            />
            <Champ
              libelle="Taille d'entreprise"
              name="taille"
              value={s.taille}
              onChange={texte("taille")}
              erreur={f.erreurs.taille}
            />
            <Select
              libelle="Objet du financement"
              name="objet"
              options={OPTIONS_OBJETS}
              invite="Non précisé"
              value={s.objet}
              onChange={texte("objet")}
              erreur={f.erreurs.objet}
            />
            <Champ
              libelle="Montant recherché"
              name="montant"
              inputMode="numeric"
              autoComplete="off"
              value={s.montant}
              onChange={texte("montant")}
              erreur={f.erreurs.montant}
              aide="Montant entier ; jamais déduit du chiffre d'affaires du client."
            />
            <Select
              libelle="Devise du montant"
              name="devise"
              options={OPTIONS_DEVISES_SERVICE}
              invite="Non précisée"
              value={s.devise}
              onChange={texte("devise")}
              erreur={f.erreurs.devise}
            />
          </div>
          <div className="mp-actions-formulaire">
            <Bouton
              type="submit"
              icone="recherche"
              chargement={f.enCours}
              texteChargement="Rapprochement…"
            >
              Lancer le rapprochement
            </Bouton>
          </div>
        </form>

        {nombreGuichets === 0 ? (
          <Alerte tonalite="info" annonce="aucune">
            <p>Aucun guichet n&apos;est saisi : le rapprochement ne renverra aucun résultat.</p>
          </Alerte>
        ) : null}

        {reponse ? (
          <section aria-label="Résultats du rapprochement" className="mp-pile">
            <Alerte tonalite="attention" annonce="status" titre="Résultat indicatif">
              <p>{reponse.avertissement}</p>
              <p>{MENTION_GUICHETS_A_VALIDER}</p>
            </Alerte>
            {reponse.tronque ? (
              <Alerte tonalite="attention" annonce="status" titre="Liste tronquée">
                <p>{messageRapprochementTronque(reponse.resultats.length)}</p>
              </Alerte>
            ) : null}
            {reponse.dossier?.chiffre_affaires_millions != null ? (
              <p className="mp-texte-doux">
                Chiffre d&apos;affaires du dossier :{" "}
                {formaterNombre(reponse.dossier.chiffre_affaires_millions)} millions (information
                seulement ; ce n&apos;est pas le montant recherché).
              </p>
            ) : null}
            {reponse.resultats.length === 0 ? (
              <p role="status">Aucun guichet à rapprocher.</p>
            ) : (
              <>
                <p role="status">
                  {comptes?.compatible ?? 0} compatible(s), {comptes?.partiel ?? 0} partiel(s),{" "}
                  {comptes?.exclu ?? 0} exclu(s).
                </p>
                <ol className="mp-liste-cartes">
                  {reponse.resultats.map((r) => (
                    <li key={r.guichet.id}>
                      <Carte
                        niveauTitre={3}
                        titre={r.guichet.nom}
                        actions={
                          <>
                            <BadgeStatut tonalite={STATUT_RAPPROCHEMENT[r.statut].tonalite}>
                              {libelleStatut(r.statut)}
                            </BadgeStatut>
                            <span>Score : {formaterNombre(r.score, 0)}</span>
                          </>
                        }
                      >
                        <div className="mp-pile">
                          <p className="mp-texte-doux">
                            {TYPE_GUICHET_LIBELLES[r.guichet.type] ?? r.guichet.type}
                            {r.guichet.date_limite
                              ? ` · date limite ${formaterDate(r.guichet.date_limite)}`
                              : ""}
                          </p>
                          {r.raisons_exclusion.length > 0 ? (
                            <div>
                              <p className="mp-champ__libelle">Raisons d&apos;exclusion</p>
                              <ul>
                                {r.raisons_exclusion.map((raison) => (
                                  <li key={raison}>{raison}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          <details>
                            <summary>Critères évalués ({r.criteres.length})</summary>
                            <ul>
                              {r.criteres.map((c) => (
                                <li key={c.critere}>
                                  <strong>{libelleCritere(c.critere)}</strong> —{" "}
                                  {VERDICT_LIBELLES[c.verdict] ?? c.verdict} : {c.detail}
                                </li>
                              ))}
                            </ul>
                          </details>
                        </div>
                      </Carte>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        ) : null}
      </div>
    </Carte>
  );
}
