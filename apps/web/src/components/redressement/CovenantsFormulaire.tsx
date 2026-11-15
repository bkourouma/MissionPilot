"use client";

import { useState, type FormEvent } from "react";
import {
  RED_COVENANT_FREQUENCES,
  RED_COVENANT_OPERATEURS,
  RED_COVENANT_RATIOS,
  RED_COVENANTS_PAR_VERSION_MAX,
  type RedCovenantFrequence,
  type RedCovenantOperateur,
  type RedCovenantRatio,
  type RedCovenantsVersionVue,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import { messageRedressement } from "../../lib/redressement";
import {
  cheminVersionsCovenants,
  libelleFrequenceCovenant,
  libelleOperateurCovenant,
  libelleRatioCovenant,
} from "../../lib/redressement-financement";
import {
  corpsCovenantsDepuisFormulaire,
  covenantVide,
  saisieCovenantsDepuis,
  uniteSeuilCovenant,
  type ChampCovenants,
  type SaisieCovenant,
  type SaisieCovenants,
} from "../../lib/redressement-financement-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

/**
 * Nouvelle version de covenants (0 à 12 lignes) : ajout seul, la version précédente reste dans
 * l'historique. Préremplie depuis la version courante. Les seuils se saisissent dans l'unité du
 * ratio (rapport ou pourcentage) ; l'évaluation est un constat arithmétique fait par l'API.
 */
export function CovenantsFormulaire({
  dossierId,
  version,
}: {
  dossierId: string;
  version: RedCovenantsVersionVue | null;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampCovenants>();
  const [s, setS] = useState<SaisieCovenants>(() => saisieCovenantsDepuis(version));
  const optionsRatios = RED_COVENANT_RATIOS.map((v) => ({
    valeur: v,
    libelle: libelleRatioCovenant(v, langue),
  }));
  const optionsOperateurs = RED_COVENANT_OPERATEURS.map((v) => ({
    valeur: v,
    libelle: libelleOperateurCovenant(v, langue),
  }));
  const optionsFrequences = RED_COVENANT_FREQUENCES.map((v) => ({
    valeur: v,
    libelle: libelleFrequenceCovenant(v, langue),
  }));

  const maj = (cle: string, valeur: Partial<SaisieCovenant>) =>
    setS((x) => ({
      ...x,
      covenants: x.covenants.map((c) => (c.cle === cle ? { ...c, ...valeur } : c)),
    }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsCovenantsDepuisFormulaire(s, langue),
      (charge) => api.post(cheminVersionsCovenants(dossierId), charge),
      {
        succes: t("Nouvelle version de covenants enregistrée.", "New covenant version saved."),
        messageSpecifique: (e) => messageRedressement(e, langue),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Nouvelle version de covenants", "New covenant version")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Enregistrement impossible", "Saving not possible")}
      />
      {f.erreurs.covenants ? (
        <Alerte tonalite="danger" annonce="alert">
          <p>{f.erreurs.covenants}</p>
        </Alerte>
      ) : null}
      {s.covenants.length === 0 ? (
        <p className="mp-texte-doux">
          {t(
            "Aucun covenant : enregistrer cette version retire tous les covenants de l'évaluation.",
            "No covenant: saving this version removes all covenants from the assessment.",
          )}
        </p>
      ) : (
        <ul className="mp-red-lignes">
          {s.covenants.map((c, i) => (
            <li key={c.cle} className="mp-red-ligne">
              <p className="mp-red-ligne__reference">Covenant {i + 1}</p>
              <Select
                libelle="Ratio"
                value={c.ratio}
                onChange={(e) => maj(c.cle, { ratio: e.target.value as RedCovenantRatio })}
                options={optionsRatios}
              />
              <Select
                libelle={t("Opérateur", "Operator")}
                value={c.operateur}
                onChange={(e) => maj(c.cle, { operateur: e.target.value as RedCovenantOperateur })}
                options={optionsOperateurs}
              />
              <Champ
                libelle={t("Seuil", "Threshold")}
                inputMode="decimal"
                autoComplete="off"
                value={c.seuil}
                onChange={(e) => maj(c.cle, { seuil: e.target.value })}
                aide={t(
                  `Unité : ${uniteSeuilCovenant(c.ratio)}.`,
                  `Unit: ${uniteSeuilCovenant(c.ratio, langue)}.`,
                )}
              />
              <Select
                libelle={t("Fréquence", "Frequency")}
                value={c.frequence}
                onChange={(e) => maj(c.cle, { frequence: e.target.value as RedCovenantFrequence })}
                options={optionsFrequences}
              />
              <Champ
                libelle={t("Prêteur (facultatif)", "Lender (optional)")}
                maxLength={120}
                autoComplete="off"
                value={c.preteur}
                onChange={(e) => maj(c.cle, { preteur: e.target.value })}
              />
              <Bouton
                variante="discret"
                aria-label={t(
                  `Retirer le covenant ${i + 1} (${libelleRatioCovenant(c.ratio)})`,
                  `Remove covenant ${i + 1} (${libelleRatioCovenant(c.ratio, langue)})`,
                )}
                onClick={() =>
                  setS((x) => ({ ...x, covenants: x.covenants.filter((y) => y.cle !== c.cle) }))
                }
              >
                {t("Retirer", "Remove")}
              </Bouton>
            </li>
          ))}
        </ul>
      )}
      <div className="mp-actions-formulaire">
        <Bouton
          variante="secondaire"
          disabled={s.covenants.length >= RED_COVENANTS_PAR_VERSION_MAX}
          onClick={() => setS((x) => ({ ...x, covenants: [...x.covenants, covenantVide()] }))}
        >
          {t("Ajouter un covenant", "Add a covenant")}
        </Bouton>
        <span className="mp-texte-doux mp-texte-petit">
          {t(
            `${s.covenants.length} sur ${RED_COVENANTS_PAR_VERSION_MAX} au plus.`,
            `${s.covenants.length} of ${RED_COVENANTS_PAR_VERSION_MAX} at most.`,
          )}
        </span>
      </div>
      <ZoneTexte
        libelle={t("Motif (facultatif)", "Reason (optional)")}
        maxLength={500}
        value={s.motif}
        onChange={(e) => setS((x) => ({ ...x, motif: e.target.value }))}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer la nouvelle version", "Save the new version")}
        </Bouton>
      </div>
    </form>
  );
}
