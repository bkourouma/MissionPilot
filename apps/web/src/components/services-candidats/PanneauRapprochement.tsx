"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  libelleTypeGuichet,
  libelleVerdict,
  mentionGuichetsAValider,
  messageRapprochementTronque,
  optionsDevisesService,
  optionsObjets,
  SAISIE_RAPPROCHEMENT_VIDE,
  statutRapprochement,
  validerRapprochement,
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampRapprochement>();
  const [s, setS] = useState<SaisieRapprochement>(SAISIE_RAPPROCHEMENT_VIDE);
  const [reponse, setReponse] = useState<ReponseRapprochement | null>(null);
  const texte = (k: keyof SaisieRapprochement) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [k]: e.target.value }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerRapprochement(s, langue),
      (charge) => api.post<ReponseRapprochement>("/api/guichets-financement/rapprochement", charge),
      { rafraichir: false, apres: setReponse },
    );
  }

  const comptes = reponse ? compterParStatut(reponse.resultats) : null;

  return (
    <Carte titre={t("Rapprochement", "Matching")} niveauTitre={2}>
      <div className="mp-pile">
        <p>
          {t(
            "Compare un client, ou un profil saisi, aux guichets de votre cabinet. Les champs renseignés ci-dessous remplacent ceux de la fiche du client.",
            "Compares a client, or an entered profile, with your firm's funding sources. The fields filled in below replace those of the client record.",
          )}
        </p>
        <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
          <RetourFormulaire
            erreur={f.erreurGlobale}
            refAlerte={f.refAlerte}
            titreErreur={t("Rapprochement impossible", "Matching failed")}
          />
          <div className="mp-grille-champs">
            <Select
              libelle={t("Client", "Client")}
              name="client_id"
              options={clients}
              invite={t("Aucun client (profil saisi)", "No client (entered profile)")}
              value={s.client_id}
              onChange={texte("client_id")}
              erreur={f.erreurs.client_id}
              aide={t(
                "Facultatif : pays, secteur, taille et filières viennent de son dossier.",
                "Optional: country, industry, size and value chains come from its file.",
              )}
            />
            <Champ
              libelle={t("Pays", "Country")}
              name="pays"
              value={s.pays}
              onChange={texte("pays")}
              erreur={f.erreurs.pays}
            />
            <Champ
              libelle={t("Secteur", "Industry")}
              name="secteur"
              value={s.secteur}
              onChange={texte("secteur")}
              erreur={f.erreurs.secteur}
            />
            <Champ
              libelle={t("Filières", "Value chains")}
              name="filieres"
              value={s.filieres}
              onChange={texte("filieres")}
              erreur={f.erreurs.filieres}
              aide={t("Séparées par des virgules.", "Separated by commas.")}
            />
            <Champ
              libelle={t("Taille d'entreprise", "Company size")}
              name="taille"
              value={s.taille}
              onChange={texte("taille")}
              erreur={f.erreurs.taille}
            />
            <Select
              libelle={t("Objet du financement", "Purpose of the financing")}
              name="objet"
              options={optionsObjets(langue)}
              invite={t("Non précisé", "Not specified")}
              value={s.objet}
              onChange={texte("objet")}
              erreur={f.erreurs.objet}
            />
            <Champ
              libelle={t("Montant recherché", "Amount sought")}
              name="montant"
              inputMode="numeric"
              autoComplete="off"
              value={s.montant}
              onChange={texte("montant")}
              erreur={f.erreurs.montant}
              aide={t(
                "Montant entier ; jamais déduit du chiffre d'affaires du client.",
                "Whole amount; never derived from the client's revenue.",
              )}
            />
            <Select
              libelle={t("Devise du montant", "Amount currency")}
              name="devise"
              options={optionsDevisesService(langue)}
              invite={t("Non précisée", "Not specified")}
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
              texteChargement={t("Rapprochement…", "Matching…")}
            >
              {t("Lancer le rapprochement", "Run the matching")}
            </Bouton>
          </div>
        </form>

        {nombreGuichets === 0 ? (
          <Alerte tonalite="info" annonce="aucune">
            <p>
              {t(
                "Aucun guichet n'est saisi : le rapprochement ne renverra aucun résultat.",
                "No funding source is entered: the matching will return no result.",
              )}
            </p>
          </Alerte>
        ) : null}

        {reponse ? (
          <section
            aria-label={t("Résultats du rapprochement", "Matching results")}
            className="mp-pile"
          >
            <Alerte
              tonalite="attention"
              annonce="status"
              titre={t("Résultat indicatif", "Indicative result")}
            >
              <p>{reponse.avertissement}</p>
              <p>{mentionGuichetsAValider(langue)}</p>
            </Alerte>
            {reponse.tronque ? (
              <Alerte
                tonalite="attention"
                annonce="status"
                titre={t("Liste tronquée", "Truncated list")}
              >
                <p>{messageRapprochementTronque(reponse.resultats.length, langue)}</p>
              </Alerte>
            ) : null}
            {reponse.dossier?.chiffre_affaires_millions != null ? (
              <p className="mp-texte-doux">
                {t("Chiffre d'affaires du dossier :", "File revenue:")}{" "}
                {formaterNombre(reponse.dossier.chiffre_affaires_millions, 2, langue)}{" "}
                {t(
                  "millions (information seulement ; ce n'est pas le montant recherché).",
                  "million (for information only; this is not the amount sought).",
                )}
              </p>
            ) : null}
            {reponse.resultats.length === 0 ? (
              <p role="status">{t("Aucun guichet à rapprocher.", "No funding source to match.")}</p>
            ) : (
              <>
                <p role="status">
                  {t(
                    `${comptes?.compatible ?? 0} compatible(s), ${comptes?.partiel ?? 0} partiel(s), ${comptes?.exclu ?? 0} exclu(s).`,
                    `${comptes?.compatible ?? 0} compatible, ${comptes?.partiel ?? 0} partial, ${comptes?.exclu ?? 0} excluded.`,
                  )}
                </p>
                <ol className="mp-liste-cartes">
                  {reponse.resultats.map((r) => (
                    <li key={r.guichet.id}>
                      <Carte
                        niveauTitre={3}
                        titre={r.guichet.nom}
                        actions={
                          <>
                            <BadgeStatut tonalite={statutRapprochement(r.statut, langue).tonalite}>
                              {libelleStatut(r.statut, langue)}
                            </BadgeStatut>
                            <span>
                              {t("Score : ", "Score: ")}
                              {formaterNombre(r.score, 0, langue)}
                            </span>
                          </>
                        }
                      >
                        <div className="mp-pile">
                          <p className="mp-texte-doux">
                            {libelleTypeGuichet(r.guichet.type, langue) ?? r.guichet.type}
                            {r.guichet.date_limite
                              ? ` · ${t("date limite", "deadline")} ${formaterDate(r.guichet.date_limite, "UTC", langue)}`
                              : ""}
                          </p>
                          {r.raisons_exclusion.length > 0 ? (
                            <div>
                              <p className="mp-champ__libelle">
                                {t("Raisons d'exclusion", "Reasons for exclusion")}
                              </p>
                              <ul>
                                {r.raisons_exclusion.map((raison) => (
                                  <li key={raison}>{raison}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          <details>
                            <summary>
                              {t("Critères évalués", "Criteria evaluated")} ({r.criteres.length})
                            </summary>
                            <ul>
                              {r.criteres.map((c) => (
                                <li key={c.critere}>
                                  <strong>{libelleCritere(c.critere, langue)}</strong> —{" "}
                                  {libelleVerdict(c.verdict, langue) ?? c.verdict}
                                  {t(" : ", ": ")}
                                  {c.detail}
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
