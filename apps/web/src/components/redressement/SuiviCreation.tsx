"use client";

import { useRef, useState, type FormEvent } from "react";
import { RED_SUIVI_JALONS_MAX, RED_SUIVI_LIBELLE_MAX } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { cheminSuivi, messageSuivi } from "../../lib/redressement-suivi";
import {
  corpsCreationSuivi,
  jalonsParDefaut,
  jalonVide,
  moisSuivant,
  type ChampCreationSuivi,
  type SaisieJalon,
} from "../../lib/redressement-suivi-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";

/**
 * Création du suivi d'un dossier clos : jalons à 6 et 12 mois par défaut, personnalisables
 * (échéances en mois après la clôture, strictement croissantes, libellé facultatif). Les dates
 * sont calculées par le serveur.
 */
export function SuiviCreation({ dossierId }: { dossierId: string }) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampCreationSuivi>();
  const [jalons, setJalons] = useState<SaisieJalon[]>(jalonsParDefaut);
  const verrou = useRef(false);

  const maj = (cle: string, champ: "mois" | "libelle", valeur: string) =>
    setJalons((l) => l.map((j) => (j.cle === cle ? { ...j, [champ]: valeur } : j)));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (verrou.current) return;
    verrou.current = true;
    try {
      await f.envoyer(
        corpsCreationSuivi(jalons, langue),
        (charge) => api.post(cheminSuivi(dossierId), charge),
        {
          succes: t("Suivi créé.", "Follow-up created."),
          messageSpecifique: (e) => messageSuivi(e, langue),
        },
      );
    } finally {
      verrou.current = false;
    }
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Créer le suivi post-mission", "Create the post-engagement follow-up")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Création impossible", "Creation not possible")}
      />
      {f.erreurs.jalons ? (
        <p className="mp-champ__erreur" role="alert">
          {f.erreurs.jalons}
        </p>
      ) : null}
      <ol className="mp-sui-lignes-jalons">
        {jalons.map((j, i) => (
          <li key={j.cle} className="mp-sui-ligne-jalon">
            <Champ
              libelle={t(
                `Jalon ${i + 1} : mois après la clôture`,
                `Milestone ${i + 1}: months after close-out`,
              )}
              type="text"
              inputMode="numeric"
              value={j.mois}
              onChange={(e) => maj(j.cle, "mois", e.target.value)}
              erreur={f.erreurs[`mois.${j.cle}`]}
              required
            />
            <Champ
              libelle={t(
                `Jalon ${i + 1} : libellé (facultatif)`,
                `Milestone ${i + 1}: label (optional)`,
              )}
              type="text"
              maxLength={RED_SUIVI_LIBELLE_MAX}
              value={j.libelle}
              onChange={(e) => maj(j.cle, "libelle", e.target.value)}
              erreur={f.erreurs[`libelle.${j.cle}`]}
            />
            <Bouton
              variante="discret"
              disabled={jalons.length <= 1}
              aria-label={t(`Retirer le jalon ${i + 1}`, `Remove milestone ${i + 1}`)}
              onClick={() => setJalons((l) => l.filter((x) => x.cle !== j.cle))}
            >
              {t("Retirer", "Remove")}
            </Bouton>
          </li>
        ))}
      </ol>
      <div className="mp-actions-formulaire">
        <Bouton
          variante="secondaire"
          disabled={jalons.length >= RED_SUIVI_JALONS_MAX}
          onClick={() => setJalons((l) => [...l, jalonVide(moisSuivant(l))])}
        >
          {t("Ajouter un jalon", "Add a milestone")}
        </Bouton>
        <Bouton
          type="submit"
          variante="primaire"
          chargement={f.enCours}
          texteChargement={t("Création…", "Creating…")}
        >
          {t("Créer le suivi", "Create the follow-up")}
        </Bouton>
      </div>
    </form>
  );
}
