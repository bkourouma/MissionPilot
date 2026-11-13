"use client";

import { useState, type FormEvent } from "react";
import { api, messageErreur } from "../../lib/api";
import {
  construireContexte,
  messageMethodes,
  resumeDifferences,
  saisieDepuisContexte,
  type Differences,
  type Differentiel,
  type Facteur,
  type SaisieContexte,
} from "../../lib/methodes";
import type { Resultat } from "../../lib/saisie";
import type { ContexteModulationApi } from "@missionpilot/shared";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useRafraichir } from "../formulaires/useRafraichir";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { ChampsContexte } from "./ChampsContexte";
import { VueDifferentiel } from "./ResultatModulation";

/**
 * Liaison d'une mission à une version publiée, avec son contexte (STD-08). `contexteInitial` :
 * contexte proposé depuis le dossier du client (STD-04), que l'utilisateur relit, complète et
 * confirme en liant ; l'API revalide le contexte.
 */
export function LiaisonMethode({
  missionId,
  versions,
  facteurs,
  contexteInitial,
}: {
  missionId: string;
  versions: { id: string; libelle: string }[];
  facteurs: Facteur[];
  contexteInitial?: ContexteModulationApi | null;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<string>();
  const [versionId, setVersionId] = useState(versions[0]?.id ?? "");
  const [contexte, setContexte] = useState<SaisieContexte>(saisieDepuisContexte(contexteInitial));
  const [motif, setMotif] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const c = construireContexte(contexte, facteurs, langue);
    const validation: Resultat<
      { version_id: string; contexte: ContexteModulationApi; motif: string | null },
      string
    > = !versionId
      ? { ok: false, erreurs: { version: t("Choisir la méthode.", "Choose the method.") } }
      : c.ok
        ? {
            ok: true,
            charge: { version_id: versionId, contexte: c.charge, motif: motif.trim() || null },
          }
        : c;
    await f.envoyer(validation, (charge) => api.put(`/api/missions/${missionId}/methode`, charge), {
      succes: t(
        "Méthode liée : la mission est figée sur cette version.",
        "Method linked: the engagement is locked to this version.",
      ),
      messageSpecifique: (e) => messageMethodes(e, langue),
    });
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Liaison impossible", "Link not possible")}
      />
      <Select
        libelle={t("Méthode et version", "Method and version")}
        required
        value={versionId}
        onChange={(e) => setVersionId(e.target.value)}
        invite={t("Choisir…", "Choose…")}
        options={versions.map((v) => ({ valeur: v.id, libelle: v.libelle }))}
        erreur={f.erreurs.version}
      />
      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">
          {t("Contexte de la mission", "Engagement context")}
        </legend>
        <ChampsContexte
          prefixe="liaison"
          facteurs={facteurs}
          valeur={contexte}
          onChange={setContexte}
          erreurs={f.erreurs}
        />
      </fieldset>
      <ZoneTexte
        libelle={t(
          "Motif (obligatoire si le contexte active ou retire une brique de classe R2 ou R3)",
          "Reason (required if the context activates or removes a class R2 or R3 building block)",
        )}
        rows={2}
        maxLength={2000}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="livre"
          chargement={f.enCours}
          texteChargement={t("Liaison…", "Linking…")}
        >
          {t("Lier la méthode", "Link the method")}
        </Bouton>
      </div>
    </form>
  );
}

/** Nouveau contexte sur la même version : règles réappliquées et journalisées. */
export function ContexteMission({
  missionId,
  facteurs,
  contexte,
}: {
  missionId: string;
  facteurs: Facteur[];
  contexte: ContexteModulationApi;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<string>();
  const [saisie, setSaisie] = useState<SaisieContexte>(saisieDepuisContexte(contexte));
  const [motif, setMotif] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const c = construireContexte(saisie, facteurs, langue);
    await f.envoyer(
      c.ok ? { ok: true, charge: { contexte: c.charge, motif: motif.trim() || null } } : c,
      (charge) => api.post(`/api/missions/${missionId}/methode/contexte`, charge),
      {
        succes: t("Contexte enregistré, règles réappliquées.", "Context saved, rules reapplied."),
        messageSpecifique: (e) => messageMethodes(e, langue),
      },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <ChampsContexte
        prefixe="contexte"
        facteurs={facteurs}
        valeur={saisie}
        onChange={setSaisie}
        erreurs={f.erreurs}
      />
      <ZoneTexte
        libelle={t(
          "Motif du changement (obligatoire si une brique de classe R2 ou R3 est activée ou retirée)",
          "Reason for the change (required if a class R2 or R3 building block is activated or removed)",
        )}
        rows={2}
        maxLength={2000}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="secondaire"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer le contexte", "Save the context")}
        </Bouton>
      </div>
    </form>
  );
}

interface AnalyseMigration {
  version_cible: { id: string; version: number; notes_version: string | null };
  differences: Differences;
  modulation: Differentiel;
  derogations_sans_objet: { id: string; brique_code: string }[];
}

/** Migration assistée vers une version plus récente : analyse d'impact, puis confirmation motivée. */
export function MigrationMethode({
  missionId,
  versionId,
}: {
  missionId: string;
  versionId: string;
}) {
  const t = useT();
  const langue = useLangue();
  const { rafraichir, enAttente } = useRafraichir();
  const [analyse, setAnalyse] = useState<AnalyseMigration | null>(null);
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoiEnCours, setEnCours] = useState(false);
  // Reste vrai tant que les données rafraîchies ne sont pas arrivées : pas de double envoi.
  const enCours = envoiEnCours || enAttente;

  async function analyser() {
    setErreur(null);
    setEnCours(true);
    try {
      setAnalyse(
        await api.get<AnalyseMigration>(
          `/api/missions/${missionId}/methode/migration?version_id=${encodeURIComponent(versionId)}`,
        ),
      );
    } catch (e) {
      setErreur(messageMethodes(e, langue) ?? messageErreur(e));
    } finally {
      setEnCours(false);
    }
  }

  async function migrer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (motif.trim().length < 10) {
      setErreur(t("Motif de 10 caractères au moins.", "Reason of at least 10 characters."));
      return;
    }
    setErreur(null);
    setEnCours(true);
    try {
      await api.post(`/api/missions/${missionId}/methode/migration`, {
        version_id: versionId,
        motif: motif.trim(),
      });
      rafraichir();
    } catch (err) {
      setErreur(messageMethodes(err, langue) ?? messageErreur(err));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-pile">
      {!analyse ? (
        <Bouton
          variante="secondaire"
          icone="recherche"
          chargement={enCours}
          onClick={() => void analyser()}
        >
          {t("Analyser l'impact de la migration", "Analyze the impact of the migration")}
        </Bouton>
      ) : (
        <form className="mp-formulaire" noValidate onSubmit={migrer}>
          {analyse.version_cible.notes_version ? (
            <p>
              <strong>{t("Notes de version :", "Version notes:")}</strong>{" "}
              {analyse.version_cible.notes_version}
            </p>
          ) : null}
          <ul className="mp-liste-simple">
            {resumeDifferences(analyse.differences, langue).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <VueDifferentiel d={analyse.modulation} langue={langue} />
          {analyse.derogations_sans_objet.length > 0 ? (
            <Alerte
              tonalite="attention"
              titre={t("Dérogations sans objet après migration", "Waivers void after migration")}
            >
              <p>{analyse.derogations_sans_objet.map((d) => d.brique_code).join(", ")}</p>
            </Alerte>
          ) : null}
          <ZoneTexte
            libelle={t("Motif de la migration", "Reason for the migration")}
            required
            rows={2}
            maxLength={2000}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
          />
          <div className="mp-actions-formulaire">
            <Bouton
              type="submit"
              chargement={enCours}
              texteChargement={t("Migration…", "Migrating…")}
            >
              {t(
                `Migrer vers la version ${analyse.version_cible.version}`,
                `Migrate to version ${analyse.version_cible.version}`,
              )}
            </Bouton>
          </div>
        </form>
      )}
      {erreur ? (
        <Alerte tonalite="danger" titre={t("Migration impossible", "Migration not possible")}>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
    </div>
  );
}
