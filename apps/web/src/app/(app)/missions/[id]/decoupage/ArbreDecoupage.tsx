"use client";

import { useState } from "react";
import { CommentairesRepliables } from "../../../../../components/collaboration/Commentaires";
import { BoutonConfirmation } from "../../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../../components/ui/Bouton";
import { EtatVide } from "../../../../../components/ui/EtatListe";
import { api } from "../../../../../lib/api";
import {
  deplacementChangementParent,
  deplacementsEchange,
  ordreSuivant,
  parentsDeTache,
  saisieDepuisTache,
  tachesDuParent,
  type Decoupage,
  type Deplacement,
  type Lot,
  type Phase,
  type Tache,
} from "../../../../../lib/decoupage";
import { formaterDate, formaterJours, formaterNombre } from "../../../../../lib/format";
import {
  FormulaireBudgetTache,
  FormulaireLibelle,
  FormulaireParent,
  FormulaireTache,
  type GradeDecoupage,
} from "./FormulairesDecoupage";

export interface DroitsDecoupage {
  planifier: boolean;
  budgeter: boolean;
  lireBudget: boolean;
}

interface Contexte {
  missionId: string;
  decoupage: Pick<Decoupage, "phases">;
  grades: GradeDecoupage[];
  droits: DroitsDecoupage;
  /** Jours budgétés agrégés par le moteur (identifiant d'élément → jours). */
  budgets: Record<string, number>;
  collaboration: CollaborationDecoupage;
  annoncer: (message: string) => void;
  reorganiser: (deplacements: Deplacement[], message: string) => Promise<boolean>;
}

/** Utilisateur courant, pour les commentaires des tâches (SOC-08). */
export interface CollaborationDecoupage {
  utilisateurId: string;
  associe: boolean;
}

export interface ArbreDecoupageProps {
  missionId: string;
  decoupage: Pick<Decoupage, "phases">;
  grades: GradeDecoupage[];
  droits: DroitsDecoupage;
  budgets: Record<string, number>;
  collaboration: CollaborationDecoupage;
}

/**
 * Découpage phases > lots > tâches (PLN-01). La réorganisation se fait au clavier avec des
 * boutons « Monter », « Descendre » et « Déplacer vers… » ; le résultat est annoncé.
 */
export function ArbreDecoupage(props: ArbreDecoupageProps) {
  const f = useFormulaire<never>();
  const [annonce, setAnnonce] = useState("");
  const [ajoutPhase, setAjoutPhase] = useState(false);
  const base = `/api/missions/${encodeURIComponent(props.missionId)}`;
  const ctx: Contexte = {
    ...props,
    annoncer: setAnnonce,
    reorganiser: (deplacements, message) =>
      f.envoyer({ ok: true, charge: { deplacements } }, (c) => api.post(`${base}/reorganiser`, c), {
        apres: () => setAnnonce(message),
      }),
  };
  const phases = props.decoupage.phases;

  return (
    <div className="mp-pile">
      <p className="mp-visuellement-cache" role="status" aria-live="polite">
        {annonce}
      </p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Action impossible"
      />
      {phases.length === 0 ? (
        <EtatVide titre="Le découpage est vide." icone="livre">
          {props.droits.planifier ? (
            <p>Ajoutez une première phase, puis ses lots et ses tâches.</p>
          ) : (
            <p>Le chef de mission n&apos;a pas encore découpé cette mission.</p>
          )}
        </EtatVide>
      ) : (
        <ol className="mp-arbre" aria-label="Découpage de la mission">
          {phases.map((p, i) => (
            <NoeudPhase key={p.id} phase={p} rang={i} total={phases.length} ctx={ctx} />
          ))}
        </ol>
      )}
      {props.droits.planifier ? (
        ajoutPhase ? (
          <FormulaireLibelle
            titre="Nouvelle phase"
            libelleEnvoi="Ajouter la phase"
            initial={{ libelle: "" }}
            avecLivrable={false}
            onAnnuler={() => setAjoutPhase(false)}
            envoyer={(c) => api.post(`${base}/phases`, { ...c, ordre: ordreSuivant(phases) })}
          />
        ) : (
          <div>
            <Bouton variante="secondaire" icone="plus" onClick={() => setAjoutPhase(true)}>
              Ajouter une phase
            </Bouton>
          </div>
        )
      ) : null}
    </div>
  );
}

type Mode = "lecture" | "edition" | "ajout-lot" | "ajout-tache" | "parent" | "budget";

function BoutonsOrdre({
  libelle,
  rang,
  total,
  monter,
  descendre,
}: {
  libelle: string;
  rang: number;
  total: number;
  monter: () => void;
  descendre: () => void;
}) {
  return (
    <>
      <Bouton
        variante="discret"
        icone="flecheHaut"
        disabled={rang === 0}
        onClick={monter}
        aria-label={`Monter ${libelle}`}
      >
        Monter
      </Bouton>
      <Bouton
        variante="discret"
        icone="flecheBas"
        disabled={rang === total - 1}
        onClick={descendre}
        aria-label={`Descendre ${libelle}`}
      >
        Descendre
      </Bouton>
    </>
  );
}

function Suppression({
  libelle,
  chemin,
  question,
}: {
  libelle: string;
  chemin: string;
  question: string;
}) {
  const f = useFormulaire<never>();
  return (
    <>
      <BoutonConfirmation
        libelle="Supprimer"
        variante="discret"
        icone="corbeille"
        ariaLabel={`Supprimer ${libelle}`}
        question={question}
        libelleConfirmation="Oui, supprimer"
        texteChargement="Suppression…"
        action={() => f.envoyer({ ok: true, charge: null }, () => api.supprimer(chemin))}
      />
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Suppression impossible"
      />
    </>
  );
}

function NoeudPhase({
  phase,
  rang,
  total,
  ctx,
}: {
  phase: Phase;
  rang: number;
  total: number;
  ctx: Contexte;
}) {
  const [mode, setMode] = useState<Mode>("lecture");
  const base = `/api/missions/${encodeURIComponent(ctx.missionId)}`;
  const phases = ctx.decoupage.phases;
  const nom = `la phase ${phase.libelle}`;
  const deplacer = (sens: -1 | 1) => {
    const d = deplacementsEchange(phases, phase.id, sens, "phase");
    if (d)
      void ctx.reorganiser(d, `Phase « ${phase.libelle} » ${sens < 0 ? "montée" : "descendue"}.`);
  };
  const enfants = phase.lots.length + phase.taches.length;
  return (
    <li className="mp-arbre__noeud mp-arbre__noeud--niveau-1">
      <div className="mp-arbre__element">
        <div className="mp-arbre__ligne">
          <p className="mp-arbre__titre">
            <span className="mp-arbre__niveau">Phase</span> {phase.libelle}
          </p>
          {ctx.droits.lireBudget ? <TotalJours valeur={ctx.budgets[phase.id]} /> : null}
        </div>
        {ctx.droits.planifier && mode === "lecture" ? (
          <div className="mp-barre-actions mp-barre-actions--compacte">
            <BoutonsOrdre
              libelle={nom}
              rang={rang}
              total={total}
              monter={() => deplacer(-1)}
              descendre={() => deplacer(1)}
            />
            <Bouton
              variante="discret"
              icone="crayon"
              onClick={() => setMode("edition")}
              aria-label={`Modifier ${nom}`}
            >
              Modifier
            </Bouton>
            <Bouton
              variante="discret"
              icone="plus"
              onClick={() => setMode("ajout-lot")}
              aria-label={`Ajouter un lot dans ${nom}`}
            >
              Ajouter un lot
            </Bouton>
            <Bouton
              variante="discret"
              icone="plus"
              onClick={() => setMode("ajout-tache")}
              aria-label={`Ajouter une tâche dans ${nom}`}
            >
              Ajouter une tâche
            </Bouton>
            <Suppression
              libelle={nom}
              chemin={`${base}/phases/${encodeURIComponent(phase.id)}`}
              question={
                enfants > 0
                  ? `Supprimer « ${phase.libelle} », ses lots, ses tâches et leurs budgets ?`
                  : `Supprimer « ${phase.libelle} » ?`
              }
            />
          </div>
        ) : null}
        {mode === "edition" ? (
          <FormulaireLibelle
            titre={`Modifier ${nom}`}
            libelleEnvoi="Enregistrer"
            initial={{ libelle: phase.libelle }}
            avecLivrable={false}
            onAnnuler={() => setMode("lecture")}
            envoyer={(c) => api.patch(`${base}/phases/${encodeURIComponent(phase.id)}`, c)}
          />
        ) : null}
      </div>
      {enfants > 0 || mode === "ajout-lot" || mode === "ajout-tache" ? (
        <ol className="mp-arbre" aria-label={`Contenu de ${nom}`}>
          {phase.lots.map((l, i) => (
            <NoeudLot
              key={l.id}
              lot={l}
              phase={phase}
              rang={i}
              total={phase.lots.length}
              ctx={ctx}
            />
          ))}
          {phase.taches.map((t, i) => (
            <NoeudTache
              key={t.id}
              tache={t}
              freres={phase.taches}
              parentId={phase.id}
              rang={i}
              ctx={ctx}
            />
          ))}
          {mode === "ajout-lot" ? (
            <li className="mp-arbre__noeud">
              <FormulaireLibelle
                titre={`Nouveau lot dans ${nom}`}
                libelleEnvoi="Ajouter le lot"
                initial={{ libelle: "", est_livrable: false }}
                avecLivrable
                onAnnuler={() => setMode("lecture")}
                envoyer={(c) =>
                  api.post(`${base}/lots`, {
                    ...c,
                    phase_id: phase.id,
                    ordre: ordreSuivant(phase.lots),
                  })
                }
              />
            </li>
          ) : null}
          {mode === "ajout-tache" ? (
            <li className="mp-arbre__noeud">
              <FormulaireTache
                titre={`Nouvelle tâche dans ${nom}`}
                libelleEnvoi="Ajouter la tâche"
                onAnnuler={() => setMode("lecture")}
                envoyer={(c) =>
                  api.post(`${base}/taches`, {
                    ...c,
                    parent_id: phase.id,
                    ordre: ordreSuivant(phase.taches),
                  })
                }
              />
            </li>
          ) : null}
        </ol>
      ) : null}
    </li>
  );
}

function NoeudLot({
  lot,
  phase,
  rang,
  total,
  ctx,
}: {
  lot: Lot;
  phase: Phase;
  rang: number;
  total: number;
  ctx: Contexte;
}) {
  const [mode, setMode] = useState<Mode>("lecture");
  const base = `/api/missions/${encodeURIComponent(ctx.missionId)}`;
  const nom = `le lot ${lot.libelle}`;
  const deplacer = (sens: -1 | 1) => {
    const d = deplacementsEchange(phase.lots, lot.id, sens, "lot", phase.id);
    if (d) void ctx.reorganiser(d, `Lot « ${lot.libelle} » ${sens < 0 ? "monté" : "descendu"}.`);
  };
  const autresPhases = ctx.decoupage.phases.map((p) => ({
    valeur: p.id,
    libelle: `Phase : ${p.libelle}`,
  }));
  return (
    <li className="mp-arbre__noeud mp-arbre__noeud--niveau-2">
      <div className="mp-arbre__element">
        <div className="mp-arbre__ligne">
          <p className="mp-arbre__titre">
            <span className="mp-arbre__niveau">Lot</span> {lot.libelle}
          </p>
          {ctx.droits.lireBudget ? <TotalJours valeur={ctx.budgets[lot.id]} /> : null}
        </div>
        {lot.est_livrable ? (
          <p className="mp-badges">
            <BadgeStatut tonalite="neutre" sansIcone>
              Livrable
            </BadgeStatut>
          </p>
        ) : null}
        {ctx.droits.planifier && mode === "lecture" ? (
          <div className="mp-barre-actions mp-barre-actions--compacte">
            <BoutonsOrdre
              libelle={nom}
              rang={rang}
              total={total}
              monter={() => deplacer(-1)}
              descendre={() => deplacer(1)}
            />
            <Bouton
              variante="discret"
              icone="deplacer"
              onClick={() => setMode("parent")}
              aria-label={`Déplacer ${nom} vers une autre phase`}
            >
              Déplacer vers…
            </Bouton>
            <Bouton
              variante="discret"
              icone="crayon"
              onClick={() => setMode("edition")}
              aria-label={`Modifier ${nom}`}
            >
              Modifier
            </Bouton>
            <Bouton
              variante="discret"
              icone="plus"
              onClick={() => setMode("ajout-tache")}
              aria-label={`Ajouter une tâche dans ${nom}`}
            >
              Ajouter une tâche
            </Bouton>
            <Suppression
              libelle={nom}
              chemin={`${base}/lots/${encodeURIComponent(lot.id)}`}
              question={
                lot.taches.length > 0
                  ? `Supprimer « ${lot.libelle} », ses tâches et leurs budgets ?`
                  : `Supprimer « ${lot.libelle} » ?`
              }
            />
          </div>
        ) : null}
        {mode === "edition" ? (
          <FormulaireLibelle
            titre={`Modifier ${nom}`}
            libelleEnvoi="Enregistrer"
            initial={{ libelle: lot.libelle, est_livrable: lot.est_livrable }}
            avecLivrable
            onAnnuler={() => setMode("lecture")}
            envoyer={(c) => api.patch(`${base}/lots/${encodeURIComponent(lot.id)}`, c)}
          />
        ) : null}
        {mode === "parent" ? (
          <FormulaireParent
            titre={`Déplacer ${nom}`}
            options={autresPhases}
            actuel={phase.id}
            onAnnuler={() => setMode("lecture")}
            envoyer={(cible) => {
              const lots = ctx.decoupage.phases.find((p) => p.id === cible)?.lots ?? [];
              const d = deplacementChangementParent("lot", lot.id, cible, lots);
              return api
                .post(`${base}/reorganiser`, { deplacements: [d] })
                .then(() => ctx.annoncer(`Lot « ${lot.libelle} » déplacé.`));
            }}
          />
        ) : null}
      </div>
      {lot.taches.length > 0 || mode === "ajout-tache" ? (
        <ol className="mp-arbre" aria-label={`Contenu de ${nom}`}>
          {lot.taches.map((t, i) => (
            <NoeudTache
              key={t.id}
              tache={t}
              freres={lot.taches}
              parentId={lot.id}
              rang={i}
              ctx={ctx}
            />
          ))}
          {mode === "ajout-tache" ? (
            <li className="mp-arbre__noeud">
              <FormulaireTache
                titre={`Nouvelle tâche dans ${nom}`}
                libelleEnvoi="Ajouter la tâche"
                onAnnuler={() => setMode("lecture")}
                envoyer={(c) =>
                  api.post(`${base}/taches`, {
                    ...c,
                    parent_id: lot.id,
                    ordre: ordreSuivant(lot.taches),
                  })
                }
              />
            </li>
          ) : null}
        </ol>
      ) : null}
    </li>
  );
}

function NoeudTache({
  tache,
  freres,
  parentId,
  rang,
  ctx,
}: {
  tache: Tache;
  freres: Tache[];
  parentId: string;
  rang: number;
  ctx: Contexte;
}) {
  const [mode, setMode] = useState<Mode>("lecture");
  const base = `/api/missions/${encodeURIComponent(ctx.missionId)}`;
  const nom = `la tâche ${tache.libelle}`;
  const deplacer = (sens: -1 | 1) => {
    const d = deplacementsEchange(freres, tache.id, sens, "tache", parentId);
    if (d)
      void ctx.reorganiser(d, `Tâche « ${tache.libelle} » ${sens < 0 ? "montée" : "descendue"}.`);
  };
  const libelleGrade = (id: string | null, code: string | null) =>
    ctx.grades.find((g) => g.id === id)?.libelle ?? code ?? "Grade";
  return (
    <li className="mp-arbre__noeud mp-arbre__noeud--niveau-3">
      <div className="mp-arbre__element">
        <div className="mp-arbre__ligne">
          <p className="mp-arbre__titre">
            <span className="mp-arbre__niveau">Tâche</span> {tache.libelle}
          </p>
          {ctx.droits.lireBudget ? <TotalJours valeur={ctx.budgets[tache.id]} /> : null}
        </div>
        <p className="mp-texte-doux mp-texte-petit">
          {`${formaterNombre(tache.duree_jours_ouvres, 0)} jour(s) ouvré(s)`}
          {tache.date_debut
            ? ` · début souhaité le ${formaterDate(tache.date_debut)}`
            : " · au plus tôt"}
        </p>
        {tache.est_livrable ? (
          <p className="mp-badges">
            <BadgeStatut tonalite="neutre" sansIcone>
              Livrable
            </BadgeStatut>
          </p>
        ) : null}
        {tache.budget && tache.budget.length > 0 ? (
          <dl className="mp-jours">
            {tache.budget.map((l) => (
              <div key={l.id} className="mp-jours__ligne">
                <dt>
                  {l.collaborateur_id
                    ? (l.collaborateur_nom ?? "Collaborateur")
                    : libelleGrade(l.grade_id, l.grade_code)}
                </dt>
                <dd>{formaterJours(l.jours)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {mode === "lecture" && (ctx.droits.planifier || ctx.droits.budgeter) ? (
          <div className="mp-barre-actions mp-barre-actions--compacte">
            {ctx.droits.planifier ? (
              <>
                <BoutonsOrdre
                  libelle={nom}
                  rang={rang}
                  total={freres.length}
                  monter={() => deplacer(-1)}
                  descendre={() => deplacer(1)}
                />
                <Bouton
                  variante="discret"
                  icone="deplacer"
                  onClick={() => setMode("parent")}
                  aria-label={`Déplacer ${nom} vers une autre phase ou un autre lot`}
                >
                  Déplacer vers…
                </Bouton>
                <Bouton
                  variante="discret"
                  icone="crayon"
                  onClick={() => setMode("edition")}
                  aria-label={`Modifier ${nom}`}
                >
                  Modifier
                </Bouton>
              </>
            ) : null}
            {ctx.droits.budgeter ? (
              <Bouton
                variante="discret"
                icone="horloge"
                onClick={() => setMode("budget")}
                aria-label={`Budgéter ${nom} en jours`}
              >
                Budget en jours
              </Bouton>
            ) : null}
            {ctx.droits.planifier ? (
              <Suppression
                libelle={nom}
                chemin={`${base}/taches/${encodeURIComponent(tache.id)}`}
                question={`Supprimer « ${tache.libelle} », son budget et ses dépendances ?`}
              />
            ) : null}
          </div>
        ) : null}
        {mode === "edition" ? (
          <FormulaireTache
            titre={`Modifier ${nom}`}
            libelleEnvoi="Enregistrer"
            initial={saisieDepuisTache(tache)}
            onAnnuler={() => setMode("lecture")}
            envoyer={(c) => api.patch(`${base}/taches/${encodeURIComponent(tache.id)}`, c)}
          />
        ) : null}
        {mode === "budget" ? (
          <FormulaireBudgetTache
            tache={tache}
            grades={ctx.grades}
            onAnnuler={() => setMode("lecture")}
            envoyer={(c) => api.put(`${base}/taches/${encodeURIComponent(tache.id)}/budget`, c)}
          />
        ) : null}
        {mode === "parent" ? (
          <FormulaireParent
            titre={`Déplacer ${nom}`}
            options={parentsDeTache(ctx.decoupage)}
            actuel={parentId}
            onAnnuler={() => setMode("lecture")}
            envoyer={(cible) => {
              const d = deplacementChangementParent(
                "tache",
                tache.id,
                cible,
                tachesDuParent(ctx.decoupage, cible),
              );
              return api
                .post(`${base}/reorganiser`, { deplacements: [d] })
                .then(() => ctx.annoncer(`Tâche « ${tache.libelle} » déplacée.`));
            }}
          />
        ) : null}
        <CommentairesRepliables
          entiteType="mission_tache"
          entiteId={tache.id}
          utilisateurId={ctx.collaboration.utilisateurId}
          associe={ctx.collaboration.associe}
          nomElement={nom}
        />
      </div>
    </li>
  );
}

function TotalJours({ valeur }: { valeur: number | undefined }) {
  if (valeur === undefined) return null;
  return (
    <span className="mp-total-jours">
      <span className="mp-visuellement-cache">Budget : </span>
      {formaterJours(valeur)}
    </span>
  );
}
