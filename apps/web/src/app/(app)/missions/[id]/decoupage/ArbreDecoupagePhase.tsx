"use client";

import { useState } from "react";
import { Bouton } from "../../../../../components/ui/Bouton";
import { api } from "../../../../../lib/api";
import { deplacementsEchange, ordreSuivant, type Phase } from "../../../../../lib/decoupage";
import { BoutonsOrdre, Suppression, TotalJours } from "./ArbreDecoupageOutils";
import { NoeudLot } from "./ArbreDecoupageLot";
import { NoeudTache } from "./ArbreDecoupageTache";
import type { Contexte, Mode } from "./arbre-decoupage-types";
import { FormulaireLibelle, FormulaireTache } from "./FormulairesDecoupage";

export function NoeudPhase({
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
