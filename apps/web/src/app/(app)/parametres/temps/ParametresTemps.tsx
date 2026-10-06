"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../components/ui/CaseACocher";
import { Champ } from "../../../../components/ui/Champ";
import { Select } from "../../../../components/ui/Select";
import { api } from "../../../../lib/api";
import {
  CONTROLE_LIBELLES,
  validerActivite,
  validerParametresTemps,
  type ParametresTemps,
} from "../../../../lib/temps-admin";
import type { ActiviteInterne } from "../../../../lib/temps";

export function FormulaireParametresTemps({ parametres }: { parametres: ParametresTemps }) {
  const [saisie, setSaisie] = useState({
    controle_capacite: parametres.controle_capacite,
    seuil_consommation_pct: String(parametres.seuil_consommation_pct),
  });
  const f = useFormulaire<"controle_capacite" | "seuil_consommation_pct">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerParametresTemps(saisie), (c) => api.patch("/api/temps/parametres", c), {
      succes: "Paramètres des temps enregistrés.",
    });
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Paramètres de saisie des temps"
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Select
          libelle="Journée au-delà de la capacité"
          options={Object.entries(CONTROLE_LIBELLES).map(([valeur, libelle]) => ({
            valeur,
            libelle,
          }))}
          value={saisie.controle_capacite}
          onChange={(e) =>
            setSaisie((s) => ({
              ...s,
              controle_capacite: e.target.value as ParametresTemps["controle_capacite"],
            }))
          }
          erreur={f.erreurs.controle_capacite}
        />
        <Champ
          libelle="Seuil d'alerte de consommation (%)"
          inputMode="numeric"
          autoComplete="off"
          value={saisie.seuil_consommation_pct}
          onChange={(e) => setSaisie((s) => ({ ...s, seuil_consommation_pct: e.target.value }))}
          erreur={f.erreurs.seuil_consommation_pct}
          aide="Le chef et le directeur de mission sont alertés quand le réalisé atteint ce pourcentage du budget (ex. 80)."
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer
        </Bouton>
      </div>
    </form>
  );
}

export function AjoutActivite() {
  const vide = { code: "", libelle: "", est_absence: false };
  const [saisie, setSaisie] = useState(vide);
  const f = useFormulaire<"code" | "libelle">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(validerActivite(saisie), (c) => api.post("/api/activites-internes", c), {
      succes: `Activité « ${saisie.libelle.trim()} » ajoutée.`,
      apres: () => setSaisie(vide),
    });
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-labelledby="titre-ajout-activite"
    >
      <h3 id="titre-ajout-activite" className="mp-sous-formulaire__titre">
        Ajouter une activité interne
      </h3>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Ajout impossible"
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Libellé"
          required
          maxLength={120}
          value={saisie.libelle}
          onChange={(e) => setSaisie((s) => ({ ...s, libelle: e.target.value }))}
          erreur={f.erreurs.libelle}
          aide="Ex. Formation, Prospection, Administration."
        />
        <Champ
          libelle="Code"
          required
          maxLength={40}
          autoComplete="off"
          value={saisie.code}
          onChange={(e) => setSaisie((s) => ({ ...s, code: e.target.value }))}
          erreur={f.erreurs.code}
          aide="Minuscules, chiffres et tiret bas (ex. prospection)."
        />
      </div>
      <CaseACocher
        libelle="C'est une absence (congé, maladie…)"
        aide="Exclue du contrôle de capacité journalière."
        checked={saisie.est_absence}
        onChange={(e) => setSaisie((s) => ({ ...s, est_absence: e.target.checked }))}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" icone="plus" chargement={f.enCours} texteChargement="Ajout…">
          Ajouter l&apos;activité
        </Bouton>
      </div>
    </form>
  );
}

export function BasculeActivite({ activite }: { activite: ActiviteInterne }) {
  const f = useFormulaire<never>();
  const actif = activite.actif !== false;
  return (
    <div className="mp-liste-lignes__actions">
      <Bouton
        variante="discret"
        icone={actif ? "fermer" : "succes"}
        chargement={f.enCours}
        texteChargement="Enregistrement…"
        aria-label={`${actif ? "Désactiver" : "Réactiver"} l'activité ${activite.libelle}`}
        onClick={() =>
          f.envoyer({ ok: true, charge: { actif: !actif } }, (c) =>
            api.patch(`/api/activites-internes/${encodeURIComponent(activite.id)}`, c),
          )
        }
      >
        {actif ? "Désactiver" : "Réactiver"}
      </Bouton>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Modification impossible"
      />
    </div>
  );
}
