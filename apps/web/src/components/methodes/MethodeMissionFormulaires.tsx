"use client";

import { useRouter } from "next/navigation";
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
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
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
  const f = useFormulaire<string>();
  const [versionId, setVersionId] = useState(versions[0]?.id ?? "");
  const [contexte, setContexte] = useState<SaisieContexte>(saisieDepuisContexte(contexteInitial));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const c = construireContexte(contexte, facteurs);
    const validation: Resultat<{ version_id: string; contexte: ContexteModulationApi }, string> =
      !versionId
        ? { ok: false, erreurs: { version: "Choisir la méthode." } }
        : c.ok
          ? { ok: true, charge: { version_id: versionId, contexte: c.charge } }
          : c;
    await f.envoyer(validation, (charge) => api.put(`/api/missions/${missionId}/methode`, charge), {
      succes: "Méthode liée : la mission est figée sur cette version.",
      messageSpecifique: messageMethodes,
    });
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Liaison impossible"
      />
      <Select
        libelle="Méthode et version"
        required
        value={versionId}
        onChange={(e) => setVersionId(e.target.value)}
        invite="Choisir…"
        options={versions.map((v) => ({ valeur: v.id, libelle: v.libelle }))}
        erreur={f.erreurs.version}
      />
      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">Contexte de la mission</legend>
        <ChampsContexte
          prefixe="liaison"
          facteurs={facteurs}
          valeur={contexte}
          onChange={setContexte}
          erreurs={f.erreurs}
        />
      </fieldset>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" icone="livre" chargement={f.enCours} texteChargement="Liaison…">
          Lier la méthode
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
  const f = useFormulaire<string>();
  const [saisie, setSaisie] = useState<SaisieContexte>(saisieDepuisContexte(contexte));
  const [motif, setMotif] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const c = construireContexte(saisie, facteurs);
    await f.envoyer(
      c.ok ? { ok: true, charge: { contexte: c.charge, motif: motif.trim() || null } } : c,
      (charge) => api.post(`/api/missions/${missionId}/methode/contexte`, charge),
      { succes: "Contexte enregistré, règles réappliquées.", messageSpecifique: messageMethodes },
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
        libelle="Motif du changement"
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
          texteChargement="Enregistrement…"
        >
          Enregistrer le contexte
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
  const router = useRouter();
  const [analyse, setAnalyse] = useState<AnalyseMigration | null>(null);
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

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
      setErreur(messageMethodes(e) ?? messageErreur(e));
    } finally {
      setEnCours(false);
    }
  }

  async function migrer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (motif.trim().length < 10) {
      setErreur("Motif de 10 caractères au moins.");
      return;
    }
    setErreur(null);
    setEnCours(true);
    try {
      await api.post(`/api/missions/${missionId}/methode/migration`, {
        version_id: versionId,
        motif: motif.trim(),
      });
      router.refresh();
    } catch (err) {
      setErreur(messageMethodes(err) ?? messageErreur(err));
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
          Analyser l&apos;impact de la migration
        </Bouton>
      ) : (
        <form className="mp-formulaire" noValidate onSubmit={migrer}>
          {analyse.version_cible.notes_version ? (
            <p>
              <strong>Notes de version :</strong> {analyse.version_cible.notes_version}
            </p>
          ) : null}
          <ul className="mp-liste-simple">
            {resumeDifferences(analyse.differences).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <VueDifferentiel d={analyse.modulation} />
          {analyse.derogations_sans_objet.length > 0 ? (
            <Alerte tonalite="attention" titre="Dérogations sans objet après migration">
              <p>{analyse.derogations_sans_objet.map((d) => d.brique_code).join(", ")}</p>
            </Alerte>
          ) : null}
          <ZoneTexte
            libelle="Motif de la migration"
            required
            rows={2}
            maxLength={2000}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
          />
          <div className="mp-actions-formulaire">
            <Bouton type="submit" chargement={enCours} texteChargement="Migration…">
              Migrer vers la version {analyse.version_cible.version}
            </Bouton>
          </div>
        </form>
      )}
      {erreur ? (
        <Alerte tonalite="danger" titre="Migration impossible">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
    </div>
  );
}
