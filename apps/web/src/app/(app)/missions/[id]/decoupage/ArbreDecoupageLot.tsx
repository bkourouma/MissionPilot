"use client";

import { useState } from "react";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../../components/ui/Bouton";
import { api } from "../../../../../lib/api";
import {
  deplacementChangementParent,
  deplacementsEchange,
  ordreSuivant,
  type Lot,
  type Phase,
} from "../../../../../lib/decoupage";
import { BoutonsOrdre, Suppression, TotalJours } from "./ArbreDecoupageOutils";
import { NoeudTache } from "./ArbreDecoupageTache";
import type { Contexte, Mode } from "./arbre-decoupage-types";
import { FormulaireLibelle, FormulaireParent, FormulaireTache } from "./FormulairesDecoupage";

export function NoeudLot({
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
