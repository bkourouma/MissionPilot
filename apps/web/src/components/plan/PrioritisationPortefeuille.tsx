"use client";

import { useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  formaterMontantMineur,
  formaterNombre,
  libelleDevise,
  type Devise,
} from "../../lib/format";
import {
  cheminArbitrer,
  cheminProposition,
  ecartsArbitrage,
  erreurMotif,
  erreursMotifs,
  libelleMotifMoteur,
  messagePortefeuille,
  saisieContraintes,
  validerArbitrage,
  validerContraintes,
  type InitiativePortefeuille,
  type Poids,
  type ReponseProposition,
  type SaisieContraintes,
} from "../../lib/plan-portefeuille";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { CaseACocher, GroupeCases } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { ZoneTexte } from "../ui/ZoneTexte";
import { useRafraichir } from "../formulaires/useRafraichir";

export interface PrioritisationPortefeuilleProps {
  planId: string;
  devise: Devise;
  poidsDefaut: Poids;
  initiatives: readonly InitiativePortefeuille[];
  /** Responsable de la mission avec « plan.valider » : arbitrage permis. */
  arbitrer: boolean;
}

/**
 * Priorisation (PLA-14) : contraintes (budget, capacité, poids, obligatoires, exclues) →
 * proposition du moteur → décision humaine. Chaque écart à la proposition exige un motif ;
 * l'API recalcule la proposition et fige l'ensemble (arbitrage tracé).
 */
const idMotif = (id: string) => `motif-ecart-${id}`;

export function PrioritisationPortefeuille({
  planId,
  devise,
  poidsDefaut,
  initiatives,
  arbitrer,
}: PrioritisationPortefeuilleProps) {
  const t = useT();
  const langue = useLangue();
  const { rafraichir, enAttente } = useRafraichir();
  const [s, setS] = useState<SaisieContraintes>(() => saisieContraintes(poidsDefaut));
  const [erreurs, setErreurs] = useState<Partial<Record<keyof SaisieContraintes, string>>>({});
  const [reponse, setReponse] = useState<ReponseProposition | null>(null);
  const [contraintes, setContraintes] = useState<Record<string, unknown> | null>(null);
  const [choisies, setChoisies] = useState<string[]>([]);
  const [motifs, setMotifs] = useState<Record<string, string>>({});
  const [erreursMotif, setErreursMotif] = useState<Record<string, string>>({});
  const [erreurArbitrage, setErreurArbitrage] = useState<string | null>(null);
  const [commentaire, setCommentaire] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [envoiEnCours, setEnCours] = useState(false);
  // Reste vrai tant que les données rafraîchies ne sont pas arrivées : pas de double envoi.
  const enCours = envoiEnCours || enAttente;
  const refErreur = useRef<HTMLDivElement>(null);
  const titres = new Map(initiatives.map((i) => [i.id, i.titre]));
  const evaluees = initiatives.filter((i) => i.evaluation);
  const options = evaluees.map((i) => ({ valeur: i.id, libelle: i.titre }));
  const champ = (
    cle: "budget_max" | "capacite_max" | "poids_valeur" | "poids_effort" | "poids_risque",
  ) => ({
    value: s[cle],
    onChange: (e: { target: { value: string } }) => setS((x) => ({ ...x, [cle]: e.target.value })),
    erreur: erreurs[cle],
  });

  async function appel<T>(action: () => Promise<T>): Promise<T | null> {
    setErreur(null);
    setSucces(null);
    setEnCours(true);
    try {
      return await action();
    } catch (e) {
      setErreur(messagePortefeuille(e, langue));
      refErreur.current?.focus();
      return null;
    } finally {
      setEnCours(false);
    }
  }

  async function proposer() {
    const v = validerContraintes(s, devise, langue);
    setErreurs(v.erreurs);
    if (!v.corps) return;
    const corps = v.corps;
    const r = await appel(() => api.post<ReponseProposition>(cheminProposition(planId), corps));
    if (r) {
      setReponse(r);
      setContraintes(corps);
      setChoisies(r.proposition.retenues);
      setMotifs({});
      setErreursMotif({});
      setErreurArbitrage(null);
    }
  }

  async function enregistrer() {
    if (!reponse || !contraintes) return;
    const v = validerArbitrage(contraintes, reponse.proposition, choisies, motifs, commentaire);
    if (!v.corps) {
      // Erreur sous chaque champ « Motif » manquant, résumée au-dessus du bouton.
      setErreur(null);
      setSucces(null);
      setErreursMotif(erreursMotifs(v.manquants, langue));
      setErreurArbitrage(
        t(
          `Motif à saisir pour : ${v.manquants.map((id) => titres.get(id) ?? id).join(", ")}.`,
          `Reason required for: ${v.manquants.map((id) => titres.get(id) ?? id).join(", ")}.`,
        ),
      );
      const premier = v.manquants[0];
      if (premier) document.getElementById(idMotif(premier))?.focus();
      return;
    }
    setErreursMotif({});
    setErreurArbitrage(null);
    const corps = v.corps;
    const r = await appel(() => api.post(cheminArbitrer(planId), corps));
    if (r) {
      setSucces(
        t(
          "Arbitrage enregistré : proposition du moteur, décision et motifs sont tracés.",
          "Prioritization saved: the engine proposal, decision and reasons are recorded.",
        ),
      );
      rafraichir();
    }
  }

  const motifsEnErreur = Object.keys(erreursMotif).some((id) =>
    erreurMotif(erreursMotif, motifs, id),
  );
  const ecarts = reponse
    ? new Set(ecartsArbitrage(reponse.proposition, choisies))
    : new Set<string>();

  return (
    <div className="mp-plan__section">
      {erreur ? (
        <Alerte
          ref={refErreur}
          tonalite="danger"
          titre={t("Opération refusée", "Operation refused")}
        >
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {succes ? (
        <Alerte tonalite="succes" annonce="status">
          <p>{succes}</p>
        </Alerte>
      ) : null}
      <div className="mp-grille-champs">
        <Champ
          libelle={t(
            `Budget maximal (${libelleDevise(devise)})`,
            `Maximum budget (${libelleDevise(devise)})`,
          )}
          inputMode="decimal"
          aide={t("Vide : sans limite.", "Empty: no limit.")}
          {...champ("budget_max")}
        />
        <Champ
          libelle={t("Capacité maximale (jours-homme)", "Maximum capacity (person-days)")}
          inputMode="numeric"
          aide={t("Vide : sans limite.", "Empty: no limit.")}
          {...champ("capacite_max")}
        />
        <Champ
          libelle={t("Poids de la valeur (0 à 10)", "Value weight (0 to 10)")}
          inputMode="numeric"
          {...champ("poids_valeur")}
        />
        <Champ
          libelle={t("Poids de l'effort (0 à 10)", "Effort weight (0 to 10)")}
          inputMode="numeric"
          {...champ("poids_effort")}
        />
        <Champ
          libelle={t("Poids du risque (0 à 10)", "Risk weight (0 to 10)")}
          inputMode="numeric"
          {...champ("poids_risque")}
        />
      </div>
      {options.length ? (
        <>
          <GroupeCases
            legende={t("Initiatives obligatoires", "Mandatory initiatives")}
            aide={t(
              "Les initiatives en cours sont retenues d'office.",
              "Initiatives in progress are selected by default.",
            )}
            nom="obligatoires"
            options={options}
            valeurs={s.obligatoires}
            onChange={(v) => setS((x) => ({ ...x, obligatoires: v }))}
          />
          <GroupeCases
            legende={t("Initiatives exclues", "Excluded initiatives")}
            nom="exclues"
            erreur={erreurs.exclues}
            options={options}
            valeurs={s.exclues}
            onChange={(v) => setS((x) => ({ ...x, exclues: v }))}
          />
        </>
      ) : null}
      <div className="mp-barre-actions">
        <Bouton
          chargement={enCours}
          texteChargement={t("Calcul…", "Calculating…")}
          onClick={() => void proposer()}
          disabled={options.length === 0}
        >
          {t("Calculer la proposition", "Compute the proposal")}
        </Bouton>
      </div>
      {reponse ? (
        <section
          className="mp-plan__section"
          aria-label={t("Proposition du moteur", "Engine proposal")}
        >
          <h4 className="mp-plan__intertitre">{t("Proposition du moteur", "Engine proposal")}</h4>
          <p>
            {t(
              `Score total ${formaterNombre(reponse.proposition.totaux.score)} · coût ${formaterMontantMineur(reponse.proposition.totaux.cout, devise)} · charge ${formaterNombre(reponse.proposition.totaux.charge)} j-h`,
              `Total score ${formaterNombre(reponse.proposition.totaux.score, 2, langue)} · cost ${formaterMontantMineur(reponse.proposition.totaux.cout, devise, langue)} · workload ${formaterNombre(reponse.proposition.totaux.charge, 2, langue)} person-days`,
            )}
            {reponse.proposition.optimal
              ? ""
              : t(
                  " · recherche interrompue : meilleure solution trouvée",
                  " · search interrupted: best solution found",
                )}
          </p>
          {reponse.proposition.realisable ? null : (
            <Alerte tonalite="attention" annonce="aucune">
              <p>
                {t(
                  "Les initiatives obligatoires dépassent une contrainte ou dépendent d'une initiative exclue.",
                  "Mandatory initiatives exceed a constraint or depend on an excluded initiative.",
                )}
              </p>
            </Alerte>
          )}
          <ul className="mp-liste-simple">
            {reponse.proposition.decisions.map((d) => (
              <li key={d.id}>
                {arbitrer ? (
                  <CaseACocher
                    libelle={`${titres.get(d.id) ?? d.id} — ${t("score", "score")} ${d.score}`}
                    aide={libelleMotifMoteur(d.motif, langue)}
                    checked={choisies.includes(d.id)}
                    onChange={(e) =>
                      setChoisies((c) =>
                        e.target.checked ? [...c, d.id] : c.filter((x) => x !== d.id),
                      )
                    }
                  />
                ) : (
                  `${titres.get(d.id) ?? d.id} — ${t("score", "score")} ${d.score} — ${d.retenue ? t("retenue", "selected") : t("écartée", "dropped")} (${libelleMotifMoteur(d.motif, langue)})`
                )}
                {arbitrer && ecarts.has(d.id) ? (
                  <Champ
                    id={idMotif(d.id)}
                    libelle={t(
                      `Motif de l'écart pour « ${titres.get(d.id) ?? d.id} »`,
                      `Reason for the deviation for \u201c${titres.get(d.id) ?? d.id}\u201d`,
                    )}
                    required
                    maxLength={1000}
                    erreur={erreurMotif(erreursMotif, motifs, d.id)}
                    value={motifs[d.id] ?? ""}
                    onChange={(e) => setMotifs((m) => ({ ...m, [d.id]: e.target.value }))}
                  />
                ) : null}
              </li>
            ))}
          </ul>
          {reponse.non_evaluees.length ? (
            <p className="mp-texte-doux mp-texte-petit">
              {t(
                `Non évaluées, donc hors proposition : ${reponse.non_evaluees.map((id) => titres.get(id) ?? id).join(", ")}.`,
                `Not assessed, so excluded from the proposal: ${reponse.non_evaluees.map((id) => titres.get(id) ?? id).join(", ")}.`,
              )}
            </p>
          ) : null}
          {arbitrer ? (
            <>
              <ZoneTexte
                libelle={t("Commentaire de l'arbitrage", "Prioritization comment")}
                rows={2}
                maxLength={2000}
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
              />
              {erreurArbitrage && motifsEnErreur ? (
                <Alerte tonalite="danger" annonce="alert">
                  <p>{erreurArbitrage}</p>
                </Alerte>
              ) : null}
              <div className="mp-barre-actions">
                <Bouton
                  variante="primaire"
                  chargement={enCours}
                  texteChargement={t("Enregistrement…", "Saving…")}
                  onClick={() => void enregistrer()}
                >
                  {t("Enregistrer l'arbitrage", "Save the prioritization")}
                </Bouton>
              </div>
            </>
          ) : (
            <p className="mp-texte-doux mp-texte-petit">
              {t(
                "L'arbitrage est réservé aux responsables de la mission qui valident le plan.",
                "Prioritization is restricted to engagement leads who approve the plan.",
              )}
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
