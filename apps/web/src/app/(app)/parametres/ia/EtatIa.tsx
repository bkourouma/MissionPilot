"use client";

import { useState, type FormEvent } from "react";
import { TACHES_GENERATIVES, type TacheGenerative } from "@missionpilot/shared";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../components/formulaires/useAttenteRafraichissement";
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
  const e = useEnregistrementIa<never>();
  const [attente, marquer] = useAttenteRafraichissement(parametres.ia_activee);
  const activer = !parametres.ia_activee;

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const ok = await e.enregistrer(
      { ok: true, charge: { ia_activee: activer } },
      { succes: messageActivation(activer, parametres.source_cle) },
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
          ? "L'IA reste désactivée tant que le cabinet ne l'active pas : jusque-là, tout contenu est produit par les gabarits. Une fois l'IA activée, les textes à traiter sont envoyés au fournisseur OpenRouter après masquage des e-mails, téléphones, identifiants et noms signalés. Chaque contenu reste un brouillon jusqu'à sa validation par un consultant."
          : "Désactiver l'IA fait passer toutes les générations sur les gabarits déterministes, sans appel au fournisseur."}
      </p>
      {e.confirmation ? (
        <ChampsReconfirmation
          saisie={e.confirmation}
          onChange={e.setConfirmation}
          erreurs={e.f.erreurs}
          motif={activer ? "activer l'IA du cabinet" : "désactiver l'IA du cabinet"}
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante={activer ? "primaire" : "secondaire"}
          chargement={e.f.enCours || attente}
          texteChargement="Enregistrement…"
        >
          {activer ? "Activer l'IA" : "Désactiver l'IA"}
        </Bouton>
      </div>
    </form>
  );
}

const OPTIONS_TACHES = TACHES_GENERATIVES.map((t) => ({ valeur: t, libelle: libelleTache(t) }));

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
      setResultat({ ok: false, ...erreurTestConnexion(e) });
    } finally {
      setEnCours(false);
    }
  }

  if (!iaActivee) {
    return (
      <p className="mp-texte-doux">
        L&apos;IA n&apos;est pas activée : activez-la (bouton « Activer l&apos;IA ») pour tester la
        connexion au fournisseur.
      </p>
    );
  }
  if (!cleDisponible) {
    return (
      <p className="mp-texte-doux">
        Aucune clé API disponible : enregistrez la clé du cabinet pour tester la connexion.
      </p>
    );
  }
  return (
    <div className="mp-pile">
      {resultat?.ok ? (
        <Alerte tonalite="succes" titre="Connexion réussie">
          <p>{phraseTest(resultat.r)}</p>
        </Alerte>
      ) : resultat ? (
        <Alerte tonalite="danger" titre={resultat.titre}>
          <p>{resultat.message}</p>
        </Alerte>
      ) : null}
      <div className="mp-grille-champs">
        <Select
          libelle="Tâche à tester"
          aide="Le modèle choisi pour cette tâche reçoit un message de quelques jetons ; l'appel est compté dans la consommation du mois."
          options={OPTIONS_TACHES}
          value={tache}
          onChange={(ev) => setTache(ev.target.value as TacheGenerative)}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          variante="secondaire"
          chargement={enCours}
          texteChargement="Test en cours…"
          onClick={tester}
        >
          Tester la connexion
        </Bouton>
      </div>
    </div>
  );
}

function phraseTest(r: ResultatTestIa): string {
  const modele = r.modele_servi ?? r.modele;
  const qui = modele ? `Le modèle ${modele}` : "Le modèle";
  const duree = typeof r.duree_ms === "number" ? ` en ${libelleDuree(r.duree_ms)}` : "";
  const cle = r.source_cle ? `, avec ${SOURCE_CLE_PHRASES[r.source_cle]}` : "";
  return `${qui} a répondu${duree}${cle}.`;
}
