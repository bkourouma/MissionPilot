"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  cheminAtelier,
  cheminAteliers,
  hrefAtelier,
  libelleMethode,
  messageAtelier,
  METHODES_ATELIER,
  OPTIONS_ATELIER_MAX,
  OPTIONS_ATELIER_MIN,
  saisieAtelierVide,
  saisieDepuisAtelier,
  validerAtelier,
  type AtelierDetail,
  type ChampAtelier,
  type SaisieAtelier,
} from "../../lib/plan-ateliers";
import type { Resultat } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { ZoneTexte } from "../ui/ZoneTexte";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import "./plan-ateliers.css";

export interface FormulaireAtelierProps {
  missionId: string;
  planId: string;
  /** Atelier en brouillon à modifier ; absent : création. */
  atelier?: AtelierDetail;
}

/**
 * Création ou modification (brouillon) d'un atelier : titre, consigne, méthodes, budget de points,
 * axes de la matrice et options (2 à 50). Les libellés d'options sont des textes saisis par des
 * personnes : l'IA les traite comme des données, jamais comme des consignes.
 */
export function FormulaireAtelier({ missionId, planId, atelier }: FormulaireAtelierProps) {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampAtelier>();
  const [s, setS] = useState<SaisieAtelier>(() =>
    atelier ? saisieDepuisAtelier(atelier) : saisieAtelierVide(langue),
  );
  const champ = (
    cle:
      | "titre"
      | "consigne"
      | "budget_points"
      | "plafond_par_option"
      | "axe_x_libelle"
      | "axe_y_libelle",
  ) => ({
    value: s[cle],
    onChange: (e: { target: { value: string } }) => setS((x) => ({ ...x, [cle]: e.target.value })),
    erreur: f.erreurs[cle],
  });

  function basculerMethode(m: (typeof METHODES_ATELIER)[number], active: boolean) {
    setS((x) => ({
      ...x,
      methodes: active ? [...x.methodes, m] : x.methodes.filter((y) => y !== m),
    }));
  }
  const majOption = (i: number, cle: "libelle" | "description", v: string) =>
    setS((x) => ({
      ...x,
      options: x.options.map((o, j) => (j === i ? { ...o, [cle]: v } : o)),
    }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = validerAtelier(s, langue);
    const validation: Resultat<NonNullable<typeof v.corps>, ChampAtelier> = v.corps
      ? { ok: true, charge: v.corps }
      : { ok: false, erreurs: v.erreurs };
    await f.envoyer(
      validation,
      async (corps) =>
        atelier
          ? api.patch<AtelierDetail>(cheminAtelier(planId, atelier.id), corps)
          : api.post<AtelierDetail>(cheminAteliers(planId), corps),
      {
        succes: atelier
          ? t("Atelier enregistré.", "Workshop saved.")
          : t("Atelier créé en brouillon.", "Workshop created as a draft."),
        messageSpecifique: (e) => messageAtelier(e, langue),
        rafraichir: Boolean(atelier),
        apres: (a) => {
          if (!atelier) router.push(hrefAtelier(missionId, planId, a.id));
        },
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={
        atelier ? t("Modifier l'atelier", "Edit the workshop") : t("Nouvel atelier", "New workshop")
      }
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Enregistrement refusé", "Save failed")}
      />
      <Champ libelle={t("Titre", "Title")} required maxLength={200} {...champ("titre")} />
      <ZoneTexte
        libelle={t("Consigne aux participants", "Instructions for participants")}
        aide={t(
          "Ce que vous attendez des participants (4 000 caractères au plus).",
          "What you expect from participants (4,000 characters at most).",
        )}
        maxLength={4000}
        rows={4}
        {...champ("consigne")}
      />
      <fieldset className="mp-formulaire__groupe" aria-describedby="methodes-erreur">
        <legend>{t("Méthodes activées", "Enabled methods")}</legend>
        {METHODES_ATELIER.map((m) => (
          <CaseACocher
            key={m}
            libelle={libelleMethode(m, langue)}
            checked={s.methodes.includes(m)}
            onChange={(e) => basculerMethode(m, e.target.checked)}
          />
        ))}
        {f.erreurs.methodes ? (
          <p id="methodes-erreur" className="mp-champ__erreur">
            {f.erreurs.methodes}
          </p>
        ) : null}
      </fieldset>
      {s.methodes.includes("vote") ? (
        <div className="mp-grille-champs">
          <Champ
            libelle={t("Points à répartir par personne", "Points to allocate per person")}
            required
            inputMode="numeric"
            {...champ("budget_points")}
          />
          <Champ
            libelle={t("Plafond de points par option", "Points cap per option")}
            aide={t("Facultatif.", "Optional.")}
            inputMode="numeric"
            {...champ("plafond_par_option")}
          />
        </div>
      ) : null}
      {s.methodes.includes("matrice") ? (
        <div className="mp-grille-champs">
          <div>
            <Champ
              libelle={t("Premier axe (abscisse)", "First axis (x-axis)")}
              required
              maxLength={60}
              {...champ("axe_x_libelle")}
            />
            <CaseACocher
              libelle={t("Une note basse est favorable", "A low score is favorable")}
              checked={s.axe_x_inverse}
              onChange={(e) => setS((x) => ({ ...x, axe_x_inverse: e.target.checked }))}
            />
          </div>
          <div>
            <Champ
              libelle={t("Second axe (ordonnée)", "Second axis (y-axis)")}
              required
              maxLength={60}
              {...champ("axe_y_libelle")}
            />
            <CaseACocher
              libelle={t("Une note basse est favorable", "A low score is favorable")}
              checked={s.axe_y_inverse}
              onChange={(e) => setS((x) => ({ ...x, axe_y_inverse: e.target.checked }))}
            />
          </div>
        </div>
      ) : null}
      <fieldset className="mp-formulaire__groupe" aria-describedby="options-erreur">
        <legend>{`${t("Options à départager", "Options to compare")} (${OPTIONS_ATELIER_MIN} ${t("à", "to")} ${OPTIONS_ATELIER_MAX})`}</legend>
        {s.options.map((o, i) => (
          <div key={i} className="mp-atelier__option-saisie">
            <Champ
              libelle={`Option ${i + 1}`}
              required
              maxLength={200}
              value={o.libelle}
              onChange={(e) => majOption(i, "libelle", e.target.value)}
            />
            <Champ
              libelle={`${t("Description de l'option", "Option description")} ${i + 1}`}
              maxLength={500}
              value={o.description}
              onChange={(e) => majOption(i, "description", e.target.value)}
            />
            {s.options.length > OPTIONS_ATELIER_MIN ? (
              <div>
                <Bouton
                  variante="discret"
                  icone="corbeille"
                  onClick={() =>
                    setS((x) => ({ ...x, options: x.options.filter((_, j) => j !== i) }))
                  }
                >
                  {`${t("Retirer l'option", "Remove option")} ${i + 1}`}
                </Bouton>
              </div>
            ) : null}
          </div>
        ))}
        {f.erreurs.options ? (
          <p id="options-erreur" className="mp-champ__erreur">
            {f.erreurs.options}
          </p>
        ) : null}
        {s.options.length < OPTIONS_ATELIER_MAX ? (
          <div>
            <Bouton
              variante="secondaire"
              icone="plus"
              onClick={() =>
                setS((x) => ({ ...x, options: [...x.options, { libelle: "", description: "" }] }))
              }
            >
              {t("Ajouter une option", "Add an option")}
            </Bouton>
          </div>
        ) : null}
      </fieldset>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {atelier ? t("Enregistrer", "Save") : t("Créer l'atelier", "Create the workshop")}
        </Bouton>
      </div>
    </form>
  );
}
