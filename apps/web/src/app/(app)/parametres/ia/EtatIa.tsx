"use client";

import { useState, type FormEvent } from "react";
import { TACHES_GENERATIVES, type Langue, type TacheGenerative } from "@missionpilot/shared";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../components/formulaires/useAttenteRafraichissement";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { ChampsReconfirmation } from "../../../../components/securite/ChampsReconfirmation";
import { Alerte } from "../../../../components/ui/Alerte";
import { Bouton } from "../../../../components/ui/Bouton";
import { Select } from "../../../../components/ui/Select";
import { api } from "../../../../lib/api";
import {
  erreurTestConnexion,
  libelleTache,
  messageActivation,
  SOURCE_CLE_PHRASES,
  SOURCE_CLE_PHRASES_EN,
  type ParametresIa,
  type ResultatTestIa,
} from "../../../../lib/ia";
import { libelleDuree } from "../../../../lib/ia-contenu";
import { useEnregistrementIa } from "./useEnregistrementIa";

/**
 * Interrupteur de l'IA du cabinet (désactivée par défaut) : sans lui, tout contenu est produit
 * par les gabarits déterministes, sans appel au fournisseur.
 */
export function ActivationIa({ parametres }: { parametres: ParametresIa }) {
  const t = useT();
  const langue = useLangue();
  const e = useEnregistrementIa<never>();
  const [attente, marquer] = useAttenteRafraichissement(parametres.ia_activee);
  const activer = !parametres.ia_activee;

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const ok = await e.enregistrer(
      { ok: true, charge: { ia_activee: activer } },
      { succes: messageActivation(activer, parametres.source_cle, langue) },
    );
    if (ok) marquer();
  }

  return (
    <form
      ref={e.f.refFormulaire}
      className="mp-formulaire"
      method="post"
      noValidate
      onSubmit={soumettre}
    >
      <RetourFormulaire erreur={e.f.erreurGlobale} succes={e.f.succes} refAlerte={e.f.refAlerte} />
      <p className="mp-texte-petit">
        {activer
          ? t(
              "L'IA reste désactivée tant que le cabinet ne l'active pas : jusque-là, tout contenu est produit par les gabarits. Une fois l'IA activée, les textes à traiter sont envoyés au fournisseur OpenRouter après masquage des e-mails, téléphones, identifiants et noms signalés. Chaque contenu reste un brouillon jusqu'à sa validation par un consultant.",
              "AI stays disabled until the firm enables it: until then, all content is produced by templates. Once AI is enabled, the texts to process are sent to the OpenRouter provider after masking e-mails, phone numbers, identifiers and flagged names. Each piece of content remains a draft until a consultant approves it.",
            )
          : t(
              "Désactiver l'IA fait passer toutes les générations sur les gabarits déterministes, sans appel au fournisseur.",
              "Disabling AI switches all generations to deterministic templates, with no call to the provider.",
            )}
      </p>
      {e.confirmation ? (
        <ChampsReconfirmation
          saisie={e.confirmation}
          onChange={e.setConfirmation}
          erreurs={e.f.erreurs}
          motif={activer ? "activer l'IA du cabinet" : "désactiver l'IA du cabinet"}
          motifEn={activer ? "enable the firm's AI" : "disable the firm's AI"}
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante={activer ? "primaire" : "secondaire"}
          chargement={e.f.enCours || attente}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {activer ? t("Activer l'IA", "Enable AI") : t("Désactiver l'IA", "Disable AI")}
        </Bouton>
      </div>
    </form>
  );
}

const optionsTaches = (langue: Langue) =>
  TACHES_GENERATIVES.map((tache) => ({ valeur: tache, libelle: libelleTache(tache, langue) }));

type ResultatAffiche =
  { ok: true; r: ResultatTestIa } | { ok: false; titre: string; message: string };

/**
 * Appel minimal du modèle d'une tâche (compté dans la consommation du mois). L'API le refuse
 * tant que l'IA n'est pas activée (409 IA_DESACTIVEE) ; une clé du cabinet indéchiffrable
 * répond 409 CLE_IA_ILLISIBLE (alerte dédiée).
 */
export function TestConnexionIa({
  iaActivee,
  cleDisponible,
}: {
  iaActivee: boolean;
  cleDisponible: boolean;
}) {
  const t = useT();
  const langue = useLangue();
  const [tache, setTache] = useState<TacheGenerative>("classification");
  const [enCours, setEnCours] = useState(false);
  const [resultat, setResultat] = useState<ResultatAffiche | null>(null);

  async function tester() {
    setEnCours(true);
    setResultat(null);
    try {
      const r = await api.post<ResultatTestIa>("/api/ia/parametres/tester", { tache });
      setResultat({ ok: true, r });
    } catch (e) {
      setResultat({ ok: false, ...erreurTestConnexion(e, langue) });
    } finally {
      setEnCours(false);
    }
  }

  if (!iaActivee) {
    return (
      <p className="mp-texte-doux">
        {t(
          "L'IA n'est pas activée : activez-la (bouton « Activer l'IA ») pour tester la connexion au fournisseur.",
          'AI is not enabled: enable it ("Enable AI" button) to test the connection to the provider.',
        )}
      </p>
    );
  }
  if (!cleDisponible) {
    return (
      <p className="mp-texte-doux">
        {t(
          "Aucune clé API disponible : enregistrez la clé du cabinet pour tester la connexion.",
          "No API key available: save the firm key to test the connection.",
        )}
      </p>
    );
  }
  return (
    <div className="mp-pile">
      {resultat?.ok ? (
        <Alerte tonalite="succes" titre={t("Connexion réussie", "Connection successful")}>
          <p>{phraseTest(resultat.r, langue)}</p>
        </Alerte>
      ) : resultat ? (
        <Alerte tonalite="danger" titre={resultat.titre}>
          <p>{resultat.message}</p>
        </Alerte>
      ) : null}
      <div className="mp-grille-champs">
        <Select
          libelle={t("Tâche à tester", "Task to test")}
          aide={t(
            "Le modèle choisi pour cette tâche reçoit un message de quelques jetons ; l'appel est compté dans la consommation du mois.",
            "The model chosen for this task receives a message of a few tokens; the call counts toward this month's usage.",
          )}
          options={optionsTaches(langue)}
          value={tache}
          onChange={(ev) => {
            setTache(ev.target.value as TacheGenerative);
            setResultat(null);
          }}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          variante="secondaire"
          chargement={enCours}
          texteChargement={t("Test en cours…", "Testing…")}
          onClick={tester}
        >
          {t("Tester la connexion", "Test the connection")}
        </Bouton>
      </div>
    </div>
  );
}

function phraseTest(r: ResultatTestIa, langue: Langue): string {
  const en = langue === "en";
  const modele = r.modele_servi ?? r.modele;
  if (en) {
    const quiEn = modele ? `The model ${modele}` : "The model";
    const dureeEn = typeof r.duree_ms === "number" ? ` in ${libelleDuree(r.duree_ms, langue)}` : "";
    const cleEn = r.source_cle ? `, using ${SOURCE_CLE_PHRASES_EN[r.source_cle]}` : "";
    return `${quiEn} responded${dureeEn}${cleEn}.`;
  }
  const qui = modele ? `Le modèle ${modele}` : "Le modèle";
  const duree = typeof r.duree_ms === "number" ? ` en ${libelleDuree(r.duree_ms)}` : "";
  const cle = r.source_cle ? `, avec ${SOURCE_CLE_PHRASES[r.source_cle]}` : "";
  return `${qui} a répondu${duree}${cle}.`;
}
