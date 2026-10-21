"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import {
  CHEMIN_EFFICACITE,
  lireAbandon,
  lireMiseEnOeuvre,
  lireRecommandation,
  messageEfficacite,
  type OptionsMission,
} from "./efficacite-outils";

/*
 * Formulaires de l'efficacité des recommandations (CAP-03) : recommander, mettre en oeuvre,
 * abandonner, mesurer l'effet. L'API reste juge de chaque droit ; aucun chiffre n'est calculé ici.
 */

const OPTS = { messageSpecifique: messageEfficacite };

export function FormulaireRecommandation({
  missionId,
  options,
}: {
  missionId: string;
  options: OptionsMission;
}) {
  const f = useFormulaire<"kpi_id" | "libelle" | "type_initiative" | "valeur_cible">();
  const [s, setS] = useState({
    kpi_id: "",
    plan_initiative_id: "",
    libelle: "",
    type_initiative: "",
    valeur_cible: "",
  });
  const maj = (k: keyof typeof s) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [k]: e.target.value }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      lireRecommandation(missionId, s),
      (c) => api.post(`${CHEMIN_EFFICACITE}/recommandations`, c),
      { ...OPTS, succes: "Recommandation enregistrée." },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <Select
        libelle="KPI observé"
        required
        invite="Choisir un KPI"
        value={s.kpi_id}
        onChange={maj("kpi_id")}
        erreur={f.erreurs.kpi_id}
        options={options.kpi.map((k) => ({
          valeur: k.id,
          libelle: `${k.libelle} (${k.unite})${k.deja_recommande ? " : déjà recommandé" : ""}`,
          desactivee: k.deja_recommande,
        }))}
      />
      <Select
        libelle="Initiative du plan (facultatif)"
        invite="Aucune"
        value={s.plan_initiative_id}
        onChange={maj("plan_initiative_id")}
        options={options.initiatives.map((i) => ({
          valeur: i.id,
          libelle: i.titre ?? "Initiative sans titre",
        }))}
      />
      <Champ
        libelle="Recommandation"
        required
        maxLength={200}
        value={s.libelle}
        onChange={maj("libelle")}
        erreur={f.erreurs.libelle}
      />
      <Champ
        libelle="Type d'initiative"
        aide="Sert à comparer des initiatives de même nature entre missions (80 caractères au plus)."
        required
        maxLength={80}
        value={s.type_initiative}
        onChange={maj("type_initiative")}
        erreur={f.erreurs.type_initiative}
      />
      <Champ
        libelle="Effet attendu : valeur cible du KPI"
        required
        inputMode="decimal"
        value={s.valeur_cible}
        onChange={maj("valeur_cible")}
        erreur={f.erreurs.valeur_cible}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours}>
          Enregistrer la recommandation
        </Bouton>
      </div>
    </form>
  );
}

export function ActionsRecommandation({
  id,
  statut,
}: {
  id: string;
  statut: "recommandee" | "mise_en_oeuvre" | "abandonnee";
}) {
  const f = useFormulaire<"date" | "motif">();
  const [date, setDate] = useState("");
  const [motif, setMotif] = useState("");
  const base = `${CHEMIN_EFFICACITE}/recommandations/${id}`;

  if (statut === "abandonnee") return null;
  return (
    <div className="mp-formulaire">
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      {statut === "mise_en_oeuvre" ? (
        <Bouton
          variante="secondaire"
          chargement={f.enCours}
          onClick={() =>
            f.envoyer({ ok: true, charge: {} }, () => api.post(`${base}/mesurer`, {}), {
              ...OPTS,
              succes: "Effet mesuré.",
            })
          }
        >
          Mesurer l&apos;effet
        </Bouton>
      ) : (
        <>
          <Champ
            libelle="Date de mise en oeuvre"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            erreur={f.erreurs.date}
          />
          <Bouton
            variante="secondaire"
            chargement={f.enCours}
            onClick={() =>
              f.envoyer(lireMiseEnOeuvre(date), (c) => api.post(`${base}/mise-en-oeuvre`, c), {
                ...OPTS,
                succes: "Mise en oeuvre enregistrée.",
              })
            }
          >
            Mettre en oeuvre
          </Bouton>
          <Champ
            libelle="Motif d'abandon"
            maxLength={500}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            erreur={f.erreurs.motif}
          />
          <Bouton
            variante="secondaire"
            chargement={f.enCours}
            onClick={() =>
              f.envoyer(lireAbandon(motif), (c) => api.post(`${base}/abandon`, c), {
                ...OPTS,
                succes: "Recommandation abandonnée.",
              })
            }
          >
            Abandonner
          </Bouton>
        </>
      )}
    </div>
  );
}
