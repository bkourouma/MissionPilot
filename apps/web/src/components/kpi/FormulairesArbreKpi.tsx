"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  cheminArbres,
  avertissementUniteLevier,
  cheminNoeud,
  cheminNoeuds,
  erreurEncoreValable,
  LIBELLES_RELATION,
  libelleRelation,
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
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";

export interface OptionKpi {
  valeur: string;
  libelle: string;
  /** Unité du KPI : sous une somme, elle doit être celle du nœud parent. */
  unite?: string;
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampArbre>();
  const [s, setS] = useState<SaisieArbre>({ kpi_racine_id: "", libelle: "" });
  // Un message de saisie disparaît dès que la valeur redevient valide.
  const validation = validerArbre(s, langue);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerArbre(s, langue),
      (charge) => api.post<DetailArbre>(cheminArbres(missionId), charge),
      {
        succes: t(
          "Arbre créé : ajoutez maintenant les leviers.",
          "Tree created: now add the drivers.",
        ),
        messageSpecifique: (e) => messagePilotage(e, langue),
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
      aria-label={t("Nouvel arbre d'indicateurs", "New KPI tree")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Création impossible", "Could not create")}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("KPI à décomposer", "KPI to break down")}
          required
          invite={t("Choisir un KPI…", "Choose a KPI…")}
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
          erreur={erreurEncoreValable(f.erreurs, validation, "kpi_racine_id")}
        />
        <Champ
          libelle={t("Libellé de l'arbre", "Tree label")}
          required
          maxLength={200}
          value={s.libelle}
          onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
          erreur={erreurEncoreValable(f.erreurs, validation, "libelle")}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement={t("Création…", "Creating…")}>
          {t("Créer l'arbre", "Create the tree")}
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampNoeud>();
  const [s, setS] = useState<SaisieNoeud>({
    ...SAISIE_NOEUD_VIDE,
    parent_id: noeuds.find((n) => n.parent_id === null)?.id ?? "",
  });
  const actifs = noeuds.filter((n) => n.actif);
  const parent = actifs.find((n) => n.id === s.parent_id);
  const uniteLevier = kpis.find((k) => k.valeur === s.kpi_id)?.unite;
  // Sous une somme, une unité différente de celle du parent n'a pas de sens : l'API refuserait.
  const avertissementUnite = avertissementUniteLevier(parent, actifs, uniteLevier, langue);
  const validation = validerNoeud(s, langue);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ok = await f.envoyer(
      validerNoeud(s, langue),
      (charge) => api.post(cheminNoeuds(arbreId), charge),
      {
        succes: t("Levier ajouté.", "Driver added."),
        messageSpecifique: (e) => messagePilotage(e, langue),
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
      aria-label={t("Nouveau levier", "New driver")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Ajout impossible", "Could not add")}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Sous le nœud", "Under the node")}
          required
          invite={t("Choisir…", "Choose…")}
          options={actifs.map((n) => ({
            valeur: n.id,
            libelle: `${n.libelle} (${libelleRelation(n.relation, langue).toLowerCase()})`,
          }))}
          value={s.parent_id}
          onChange={(e) => setS((x) => ({ ...x, parent_id: e.target.value }))}
          erreur={erreurEncoreValable(f.erreurs, validation, "parent_id")}
        />
        <Select
          libelle={t("KPI mesurant ce levier", "KPI measuring this driver")}
          invite={t("Aucun (levier libre)", "None (free driver)")}
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
          aide={t(
            "Sans KPI lié, la décomposition ne peut pas se calculer : le levier est signalé comme manquant.",
            "Without a linked KPI, the breakdown cannot be computed: the driver is flagged as missing.",
          )}
        />
        <Champ
          libelle={t("Libellé du levier", "Driver label")}
          required
          maxLength={200}
          value={s.libelle}
          onChange={(e) => setS((x) => ({ ...x, libelle: e.target.value }))}
          erreur={erreurEncoreValable(f.erreurs, validation, "libelle")}
        />
        <Select
          libelle={t("Ses propres leviers se combinent en", "Its own drivers combine as")}
          options={(Object.keys(LIBELLES_RELATION) as RelationArbre[]).map((r) => ({
            valeur: r,
            libelle: libelleRelation(r, langue),
          }))}
          value={s.relation}
          onChange={(e) => setS((x) => ({ ...x, relation: e.target.value as RelationArbre }))}
        />
        <Champ
          libelle={t("Coefficient dans la somme du parent", "Coefficient in the parent's sum")}
          inputMode="decimal"
          autoComplete="off"
          disabled={parent?.relation === "produit"}
          value={parent?.relation === "produit" ? "1" : s.coefficient}
          onChange={(e) => setS((x) => ({ ...x, coefficient: e.target.value }))}
          erreur={erreurEncoreValable(f.erreurs, validation, "coefficient")}
          aide={t(
            "1 par défaut ; -1 pour un coût qui se retranche. Toujours 1 sous un produit.",
            "1 by default; -1 for a cost that is subtracted. Always 1 under a product.",
          )}
        />
        <Champ
          libelle={t("Rang parmi les frères", "Rank among siblings")}
          inputMode="numeric"
          value={s.rang}
          onChange={(e) => setS((x) => ({ ...x, rang: e.target.value }))}
          erreur={erreurEncoreValable(f.erreurs, validation, "rang")}
          aide={t(
            "Ordre de la décomposition d'un produit : le premier rang passe en premier.",
            "Order of a product's breakdown: the first rank comes first.",
          )}
        />
      </div>
      {avertissementUnite ? (
        <Alerte
          tonalite="attention"
          titre={t("Unités différentes", "Different units")}
          annonce="status"
        >
          <p>{avertissementUnite}</p>
        </Alerte>
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement={t("Ajout…", "Adding…")}>
          {t("Ajouter le levier", "Add the driver")}
        </Bouton>
      </div>
    </form>
  );
}

/**
 * Change la façon dont un nœud combine ses leviers (somme pondérée ou produit). Une somme n'admet
 * que des unités identiques ; pour des unités différentes (volume × panier moyen), le nœud se
 * combine en produit. L'API refuse un changement qui ferait additionner des unités différentes.
 */
export function ChangerRelationNoeud({ noeud }: { noeud: Pick<NoeudArbre, "id" | "relation"> }) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"relation">();
  const [relation, setRelation] = useState<RelationArbre>(noeud.relation);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      { ok: true as const, charge: { relation } },
      (charge) => api.patch(cheminNoeud(noeud.id), charge),
      {
        succes: t("Combinaison modifiée.", "Combination changed."),
        messageSpecifique: (e) => messagePilotage(e, langue),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Changer la combinaison des leviers", "Change how the drivers combine")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Changement impossible", "Could not change")}
      />
      <Select
        libelle={t("Combine ses leviers en", "Combines its drivers as")}
        options={(Object.keys(LIBELLES_RELATION) as RelationArbre[]).map((r) => ({
          valeur: r,
          libelle: libelleRelation(r, langue),
        }))}
        value={relation}
        onChange={(e) => setRelation(e.target.value as RelationArbre)}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="discret"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
          disabled={relation === noeud.relation}
        >
          {t("Appliquer", "Apply")}
        </Bouton>
      </div>
    </form>
  );
}
