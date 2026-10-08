"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  cheminArbres,
  cheminNoeuds,
  LIBELLES_RELATION,
  messagePilotage,
  validerArbre,
  validerNoeud,
  type ChampArbre,
  type ChampNoeud,
  type DetailArbre,
  type NoeudArbre,
  type RelationArbre,
  type SaisieArbre,
  type SaisieNoeud,
} from "../../lib/kpi-pilotage";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";

export interface OptionKpi {
  valeur: string;
  libelle: string;
}

/**
 * Nouvel arbre d'indicateurs (KPI-13) : le KPI à décomposer devient la racine. Un seul arbre par
 * KPI ; les leviers s'ajoutent ensuite, un par un, sous la racine ou sous un autre levier.
 */
export function FormulaireArbre({
  missionId,
  kpis,
}: {
  missionId: string;
  kpis: readonly OptionKpi[];
}) {
  const f = useFormulaire<ChampArbre>();
  const [s, setS] = useState<SaisieArbre>({ kpi_racine_id: "", libelle: "" });

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerArbre(s),
      (charge) => api.post<DetailArbre>(cheminArbres(missionId), charge),
      {
        succes: "Arbre créé : ajoutez maintenant les leviers.",
        messageSpecifique: messagePilotage,
      },
    );
    if (ok) setS({ kpi_racine_id: "", libelle: "" });
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Nouvel arbre d'indicateurs"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Création impossible"
      />
      <div className="mp-grille-champs">
        <Select
          libelle="KPI à décomposer"
          required
          invite="Choisir un KPI…"
          options={kpis}
          value={s.kpi_racine_id}
          onChange={(e) => {
            const id = e.target.value;
            setS((x) => ({
              ...x,
              kpi_racine_id: id,
              libelle: x.libelle || (kpis.find((k) => k.valeur === id)?.libelle ?? ""),
            }));
          }}
          erreur={f.erreurs.kpi_racine_id}
        />
        <Champ
          libelle="Libellé de l'arbre"
          required
          maxLength={200}
          value={s.libelle}
          onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
          erreur={f.erreurs.libelle}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Création…">
          Créer l&apos;arbre
        </Bouton>
      </div>
    </form>
  );
}

const SAISIE_NOEUD_VIDE: SaisieNoeud = {
  parent_id: "",
  kpi_id: "",
  libelle: "",
  relation: "somme",
  coefficient: "1",
  rang: "0",
};

/**
 * Nouveau levier : sous un nœud existant, lié (ou non) à un KPI de la mission. Sous un nœud
 * « produit », le coefficient reste 1 ; sous une somme, un coefficient négatif retranche le levier
 * (un coût d'une marge). Le rang fixe l'ordre des frères, donc celui de la décomposition d'un produit.
 */
export function FormulaireNoeud({
  arbreId,
  noeuds,
  kpis,
}: {
  arbreId: string;
  noeuds: readonly NoeudArbre[];
  kpis: readonly OptionKpi[];
}) {
  const f = useFormulaire<ChampNoeud>();
  const [s, setS] = useState<SaisieNoeud>({
    ...SAISIE_NOEUD_VIDE,
    parent_id: noeuds.find((n) => n.parent_id === null)?.id ?? "",
  });
  const actifs = noeuds.filter((n) => n.actif);
  const parent = actifs.find((n) => n.id === s.parent_id);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerNoeud(s),
      (charge) => api.post(cheminNoeuds(arbreId), charge),
      {
        succes: "Levier ajouté.",
        messageSpecifique: messagePilotage,
      },
    );
    if (ok) setS((x) => ({ ...SAISIE_NOEUD_VIDE, parent_id: x.parent_id }));
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Nouveau levier"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Ajout impossible"
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Sous le nœud"
          required
          invite="Choisir…"
          options={actifs.map((n) => ({
            valeur: n.id,
            libelle: `${n.libelle} (${LIBELLES_RELATION[n.relation].toLowerCase()})`,
          }))}
          value={s.parent_id}
          onChange={(e) => setS((x) => ({ ...x, parent_id: e.target.value }))}
          erreur={f.erreurs.parent_id}
        />
        <Select
          libelle="KPI mesurant ce levier"
          invite="Aucun (levier libre)"
          options={kpis}
          value={s.kpi_id}
          onChange={(e) => {
            const id = e.target.value;
            setS((x) => ({
              ...x,
              kpi_id: id,
              libelle: x.libelle || (kpis.find((k) => k.valeur === id)?.libelle ?? ""),
            }));
          }}
          aide="Sans KPI lié, la décomposition ne peut pas se calculer : le levier est signalé comme manquant."
        />
        <Champ
          libelle="Libellé du levier"
          required
          maxLength={200}
          value={s.libelle}
          onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
          erreur={f.erreurs.libelle}
        />
        <Select
          libelle="Ses propres leviers se combinent en"
          options={(Object.keys(LIBELLES_RELATION) as RelationArbre[]).map((r) => ({
            valeur: r,
            libelle: LIBELLES_RELATION[r],
          }))}
          value={s.relation}
          onChange={(e) => setS((x) => ({ ...x, relation: e.target.value as RelationArbre }))}
        />
        <Champ
          libelle="Coefficient dans la somme du parent"
          inputMode="decimal"
          autoComplete="off"
          disabled={parent?.relation === "produit"}
          value={parent?.relation === "produit" ? "1" : s.coefficient}
          onChange={(e) => setS((x) => ({ ...x, coefficient: e.target.value }))}
          erreur={f.erreurs.coefficient}
          aide="1 par défaut ; -1 pour un coût qui se retranche. Toujours 1 sous un produit."
        />
        <Champ
          libelle="Rang parmi les frères"
          inputMode="numeric"
          value={s.rang}
          onChange={(e) => setS((x) => ({ ...x, rang: e.target.value }))}
          erreur={f.erreurs.rang}
          aide="Ordre de la décomposition d'un produit : le premier rang passe en premier."
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Ajout…">
          Ajouter le levier
        </Bouton>
      </div>
    </form>
  );
}
