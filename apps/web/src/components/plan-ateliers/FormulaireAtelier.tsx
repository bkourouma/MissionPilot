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
  const f = useFormulaire<ChampAtelier>();
  const [s, setS] = useState<SaisieAtelier>(() =>
    atelier ? saisieDepuisAtelier(atelier) : saisieAtelierVide(),
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
    const v = validerAtelier(s);
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
        succes: atelier ? "Atelier enregistré." : "Atelier créé en brouillon.",
        messageSpecifique: messageAtelier,
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
      aria-label={atelier ? "Modifier l'atelier" : "Nouvel atelier"}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Enregistrement refusé"
      />
      <Champ libelle="Titre" required maxLength={200} {...champ("titre")} />
      <ZoneTexte
        libelle="Consigne aux participants"
        aide="Ce que vous attendez des participants (4 000 caractères au plus)."
        maxLength={4000}
        rows={4}
        {...champ("consigne")}
      />
      <fieldset className="mp-formulaire__groupe" aria-describedby="methodes-erreur">
        <legend>Méthodes activées</legend>
        {METHODES_ATELIER.map((m) => (
          <CaseACocher
            key={m}
            libelle={libelleMethode(m)}
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
            libelle="Points à répartir par personne"
            required
            inputMode="numeric"
            {...champ("budget_points")}
          />
          <Champ
            libelle="Plafond de points par option"
            aide="Facultatif."
            inputMode="numeric"
            {...champ("plafond_par_option")}
          />
        </div>
      ) : null}
      {s.methodes.includes("matrice") ? (
        <div className="mp-grille-champs">
          <div>
            <Champ
              libelle="Premier axe (abscisse)"
              required
              maxLength={60}
              {...champ("axe_x_libelle")}
            />
            <CaseACocher
              libelle="Une note basse est favorable"
              checked={s.axe_x_inverse}
              onChange={(e) => setS((x) => ({ ...x, axe_x_inverse: e.target.checked }))}
            />
          </div>
          <div>
            <Champ
              libelle="Second axe (ordonnée)"
              required
              maxLength={60}
              {...champ("axe_y_libelle")}
            />
            <CaseACocher
              libelle="Une note basse est favorable"
              checked={s.axe_y_inverse}
              onChange={(e) => setS((x) => ({ ...x, axe_y_inverse: e.target.checked }))}
            />
          </div>
        </div>
      ) : null}
      <fieldset className="mp-formulaire__groupe" aria-describedby="options-erreur">
        <legend>{`Options à départager (${OPTIONS_ATELIER_MIN} à ${OPTIONS_ATELIER_MAX})`}</legend>
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
              libelle={`Description de l'option ${i + 1}`}
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
                  {`Retirer l'option ${i + 1}`}
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
              Ajouter une option
            </Bouton>
          </div>
        ) : null}
      </fieldset>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {atelier ? "Enregistrer" : "Créer l'atelier"}
        </Bouton>
      </div>
    </form>
  );
}
