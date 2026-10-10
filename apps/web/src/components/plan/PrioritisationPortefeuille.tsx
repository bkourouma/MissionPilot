"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "../../lib/api";
import { formaterMontantMineur, formaterNombre, type Devise } from "../../lib/format";
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
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { CaseACocher, GroupeCases } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { ZoneTexte } from "../ui/ZoneTexte";

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
  const router = useRouter();
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
  const [enCours, setEnCours] = useState(false);
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
      setErreur(messagePortefeuille(e));
      refErreur.current?.focus();
      return null;
    } finally {
      setEnCours(false);
    }
  }

  async function proposer() {
    const v = validerContraintes(s, devise);
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
      setErreursMotif(erreursMotifs(v.manquants));
      setErreurArbitrage(
        `Motif à saisir pour : ${v.manquants.map((id) => titres.get(id) ?? id).join(", ")}.`,
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
      setSucces("Arbitrage enregistré : proposition du moteur, décision et motifs sont tracés.");
      router.refresh();
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
        <Alerte ref={refErreur} tonalite="danger" titre="Opération refusée">
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
          libelle={`Budget maximal (${devise})`}
          inputMode="decimal"
          aide="Vide : sans limite."
          {...champ("budget_max")}
        />
        <Champ
          libelle="Capacité maximale (jours-homme)"
          inputMode="numeric"
          aide="Vide : sans limite."
          {...champ("capacite_max")}
        />
        <Champ
          libelle="Poids de la valeur (0 à 10)"
          inputMode="numeric"
          {...champ("poids_valeur")}
        />
        <Champ
          libelle="Poids de l'effort (0 à 10)"
          inputMode="numeric"
          {...champ("poids_effort")}
        />
        <Champ libelle="Poids du risque (0 à 10)" inputMode="numeric" {...champ("poids_risque")} />
      </div>
      {options.length ? (
        <>
          <GroupeCases
            legende="Initiatives obligatoires"
            aide="Les initiatives en cours sont retenues d'office."
            nom="obligatoires"
            options={options}
            valeurs={s.obligatoires}
            onChange={(v) => setS((x) => ({ ...x, obligatoires: v }))}
          />
          <GroupeCases
            legende="Initiatives exclues"
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
          texteChargement="Calcul…"
          onClick={() => void proposer()}
          disabled={options.length === 0}
        >
          Calculer la proposition
        </Bouton>
      </div>
      {reponse ? (
        <section className="mp-plan__section" aria-label="Proposition du moteur">
          <h4 className="mp-plan__intertitre">Proposition du moteur</h4>
          <p>
            {`Score total ${formaterNombre(reponse.proposition.totaux.score)} · coût ${formaterMontantMineur(reponse.proposition.totaux.cout, devise)} · charge ${formaterNombre(reponse.proposition.totaux.charge)} j-h`}
            {reponse.proposition.optimal
              ? ""
              : " · recherche interrompue : meilleure solution trouvée"}
          </p>
          {reponse.proposition.realisable ? null : (
            <Alerte tonalite="attention" annonce="aucune">
              <p>
                Les initiatives obligatoires dépassent une contrainte ou dépendent d&apos;une
                initiative exclue.
              </p>
            </Alerte>
          )}
          <ul className="mp-liste-simple">
            {reponse.proposition.decisions.map((d) => (
              <li key={d.id}>
                {arbitrer ? (
                  <CaseACocher
                    libelle={`${titres.get(d.id) ?? d.id} — score ${d.score}`}
                    aide={libelleMotifMoteur(d.motif)}
                    checked={choisies.includes(d.id)}
                    onChange={(e) =>
                      setChoisies((c) =>
                        e.target.checked ? [...c, d.id] : c.filter((x) => x !== d.id),
                      )
                    }
                  />
                ) : (
                  `${titres.get(d.id) ?? d.id} — score ${d.score} — ${d.retenue ? "retenue" : "écartée"} (${libelleMotifMoteur(d.motif)})`
                )}
                {arbitrer && ecarts.has(d.id) ? (
                  <Champ
                    id={idMotif(d.id)}
                    libelle={`Motif de l'écart pour « ${titres.get(d.id) ?? d.id} »`}
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
              {`Non évaluées, donc hors proposition : ${reponse.non_evaluees.map((id) => titres.get(id) ?? id).join(", ")}.`}
            </p>
          ) : null}
          {arbitrer ? (
            <>
              <ZoneTexte
                libelle="Commentaire de l'arbitrage"
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
                  texteChargement="Enregistrement…"
                  onClick={() => void enregistrer()}
                >
                  Enregistrer l&apos;arbitrage
                </Bouton>
              </div>
            </>
          ) : (
            <p className="mp-texte-doux mp-texte-petit">
              L&apos;arbitrage est réservé aux responsables de la mission qui valident le plan.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
