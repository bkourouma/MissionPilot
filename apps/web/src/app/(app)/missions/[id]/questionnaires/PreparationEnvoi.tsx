"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Alerte } from "../../../../../components/ui/Alerte";
import { Bouton } from "../../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../../components/ui/CaseACocher";
import { Champ } from "../../../../../components/ui/Champ";
import { EtatVide } from "../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../components/ui/Icone";
import type { OptionSelect } from "../../../../../components/ui/Select";
import { Select } from "../../../../../components/ui/Select";
import { Squelette } from "../../../../../components/ui/Squelette";
import { api, messageErreur } from "../../../../../lib/api";
import {
  AIDE_MODE,
  aideAucunRepondant,
  cheminModeles,
  cheminRepondantsEligibles,
  dateDuJour,
  estRefusRepondant,
  FONCTION_MAX,
  garderRepondants,
  hrefEnvoi,
  messageCreationEnvoi,
  messageRepondantsEligibles,
  modelesEnvoyables,
  OPTIONS_MODES,
  PAGES_MAX_REPONDANTS,
  rolesRepondant,
  SAISIE_ENVOI_VIDE,
  TAILLE_PAGE_CHOIX,
  TITRE_AUCUN_REPONDANT,
  toutesLesPages,
  validerEnvoi,
  type ChampEnvoi,
  type EnvoiDetail,
  type ModeleResume,
  type PageQuestionnaires,
  type PageRepondantsEligibles,
  type RepondantEligible,
  type SaisieEnvoi,
} from "../../../../../lib/questionnaires";
import "../../../../../components/questionnaires/questionnaires.css";

export interface PreparationEnvoiProps {
  missionId: string;
  clientNom: string;
  /**
   * Onglet « Portail client » de la fiche du client, proposé quand aucun répondant n'est
   * éligible ; `null` sans le droit d'y inviter (`portail.gerer`).
   */
  hrefPortail: string | null;
}

/** Bouton « Préparer un envoi » et formulaire, chargé à l'ouverture (connexion épargnée). */
export function PreparationEnvoi(props: PreparationEnvoiProps) {
  const [ouvert, setOuvert] = useState(false);
  if (!ouvert) {
    return (
      <div>
        <Bouton icone="envoyer" onClick={() => setOuvert(true)}>
          Préparer un envoi
        </Bouton>
      </div>
    );
  }
  return (
    <section className="mp-sous-formulaire mp-pile" aria-labelledby="titre-preparation">
      <h2 id="titre-preparation" className="mp-sous-formulaire__titre">
        Préparer l'envoi d'un questionnaire
      </h2>
      <FormulaireEnvoi {...props} onAnnuler={() => setOuvert(false)} />
    </section>
  );
}

type ListeRepondants =
  { ok: true; elements: RepondantEligible[]; tronquee: boolean } | { ok: false; message: string };

type Chargement =
  | { phase: "chargement" }
  | { phase: "erreur"; message: string }
  | { phase: "pret"; versions: OptionSelect[]; tronquee: boolean; repondants: ListeRepondants };

type PatchRepondant = Partial<{ choisi: boolean; fonction: string }>;

function FormulaireEnvoi({
  missionId,
  clientNom,
  hrefPortail,
  onAnnuler,
}: PreparationEnvoiProps & { onAnnuler: () => void }) {
  const router = useRouter();
  const [etat, setEtat] = useState<Chargement>({ phase: "chargement" });
  const [actualisation, setActualisation] = useState(false);
  const [s, setS] = useState<SaisieEnvoi>(SAISIE_ENVOI_VIDE);
  const f = useFormulaire<ChampEnvoi>();
  const aujourdhui = dateDuJour(new Date());

  /**
   * Répondants désignables de la mission (route dédiée, `questionnaire.gerer`), toutes pages
   * jusqu'au plafond ; la saisie ne garde que les répondants encore proposés.
   */
  const lireRepondants = useCallback(async (): Promise<ListeRepondants> => {
    try {
      const r = await toutesLesPages(
        (chemin) => api.get<PageRepondantsEligibles>(chemin),
        (curseur) => cheminRepondantsEligibles(missionId, curseur),
        PAGES_MAX_REPONDANTS,
      );
      setS((x) => ({ ...x, repondants: garderRepondants(x.repondants, r.elements) }));
      return { ok: true, elements: r.elements, tronquee: r.tronquee };
    } catch (e) {
      return { ok: false, message: messageRepondantsEligibles(e) };
    }
  }, [missionId]);

  const charger = useCallback(async () => {
    setEtat({ phase: "chargement" });
    try {
      const [modeles, repondants] = await Promise.all([
        toutesLesPages(
          (chemin) => api.get<PageQuestionnaires<ModeleResume>>(chemin),
          (curseur) => cheminModeles(curseur, TAILLE_PAGE_CHOIX),
        ),
        lireRepondants(),
      ]);
      setEtat({
        phase: "pret",
        versions: modelesEnvoyables(modeles.elements),
        tronquee: modeles.tronquee,
        repondants,
      });
    } catch (e) {
      setEtat({ phase: "erreur", message: messageErreur(e) });
    }
  }, [lireRepondants]);

  const actualiserRepondants = useCallback(async () => {
    setActualisation(true);
    const repondants = await lireRepondants();
    setEtat((x) => (x.phase === "pret" ? { ...x, repondants } : x));
    setActualisation(false);
  }, [lireRepondants]);

  useEffect(() => {
    void charger();
  }, [charger]);

  if (etat.phase === "chargement") {
    return (
      <Squelette lignes={5} libelle="Chargement des questionnaires validés et des répondants…" />
    );
  }
  if (etat.phase === "erreur") {
    return (
      <div className="mp-pile">
        <Alerte tonalite="danger" titre="Préparation impossible">
          <p>{etat.message}</p>
        </Alerte>
        <div className="mp-barre-actions">
          <Bouton variante="secondaire" onClick={() => void charger()}>
            Réessayer
          </Bouton>
          <Bouton variante="discret" onClick={onAnnuler}>
            Annuler
          </Bouton>
        </div>
      </div>
    );
  }
  if (etat.versions.length === 0) {
    return (
      <EtatVide
        titre="Aucun questionnaire validé à envoyer."
        icone="bulle"
        action={
          <div className="mp-barre-actions">
            <Link href="/questionnaires">Préparer et valider un modèle</Link>
            <Bouton variante="discret" onClick={onAnnuler}>
              Fermer
            </Bouton>
          </div>
        }
      >
        <p>Seule une version validée (figée) d'un modèle du cabinet s'envoie aux répondants.</p>
      </EtatVide>
    );
  }

  const comptes = etat.repondants.ok ? etat.repondants.elements : [];
  const choisis = comptes.filter((c) => s.repondants[c.id]?.choisi).length;
  const choisir = (id: string, patch: PatchRepondant) =>
    setS((x) => {
      const r = x.repondants[id] ?? { choisi: false, fonction: "" };
      return { ...x, repondants: { ...x.repondants, [id]: { ...r, ...patch } } };
    });
  const toutCocher = (choisi: boolean) =>
    setS((x) => ({
      ...x,
      repondants: Object.fromEntries(
        comptes.map((c) => [c.id, { choisi, fonction: x.repondants[c.id]?.fonction ?? "" }]),
      ),
    }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerEnvoi(s, aujourdhui),
      async (charge) => {
        try {
          return await api.post<EnvoiDetail>(
            `/api/missions/${encodeURIComponent(missionId)}/questionnaires`,
            charge,
          );
        } catch (e) {
          // Compte désactivé ou client archivé entre-temps : la liste (et la sélection) suit.
          if (estRefusRepondant(e)) void actualiserRepondants();
          throw e;
        }
      },
      {
        rafraichir: false,
        messageSpecifique: messageCreationEnvoi,
        apres: (e) => router.push(hrefEnvoi(missionId, e.id)),
      },
    );
  }

  const idErreurRepondants = f.erreurs.repondants ? "envoi-repondants-erreur" : undefined;

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-formulaire--ligne"
      noValidate
      onSubmit={soumettre}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Préparation impossible"
      />
      <p className="mp-indice mp-texte-doux mp-texte-petit">
        <Icone nom="info" taille={16} />
        <span>
          L'envoi est d'abord créé en brouillon : rien n'est transmis aux répondants avant que vous
          ne l'envoyiez depuis sa page.
        </span>
      </p>
      <Select
        libelle="Questionnaire (dernière version validée)"
        name="version_id"
        required
        invite="Choisir un questionnaire…"
        options={etat.versions}
        value={s.version_id}
        erreur={f.erreurs.version_id}
        aide={
          etat.tronquee ? "Liste partielle : seuls les premiers modèles sont proposés." : undefined
        }
        onChange={(e) => setS((x) => ({ ...x, version_id: e.target.value }))}
      />

      <fieldset className="mp-groupe" aria-invalid={f.erreurs.mode ? true : undefined}>
        <legend className="mp-champ__libelle">
          Mode de réponse
          <span className="mp-champ__requis">
            {" "}
            <span aria-hidden="true">*</span>
            <span className="mp-visuellement-cache">(obligatoire)</span>
          </span>
        </legend>
        <div className="mp-groupe__options">
          {OPTIONS_MODES.map((o) => (
            <div key={o.valeur} className="mp-case">
              <input
                type="radio"
                id={`envoi-mode-${o.valeur}`}
                name="mode"
                value={o.valeur}
                className="mp-case__controle"
                checked={s.mode === o.valeur}
                onChange={() => setS((x) => ({ ...x, mode: o.valeur }))}
                aria-describedby={`envoi-mode-${o.valeur}-aide`}
              />
              <label htmlFor={`envoi-mode-${o.valeur}`} className="mp-case__libelle">
                {o.libelle}
                <span id={`envoi-mode-${o.valeur}-aide`} className="mp-case__aide">
                  {AIDE_MODE[o.valeur]}
                </span>
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset
        className={f.erreurs.repondants ? "mp-groupe mp-groupe--erreur" : "mp-groupe"}
        aria-invalid={f.erreurs.repondants ? true : undefined}
        aria-describedby={idErreurRepondants}
      >
        <legend className="mp-champ__libelle">
          {`Répondants de ${clientNom} (${choisis} choisi${choisis > 1 ? "s" : ""})`}
          <span className="mp-champ__requis">
            {" "}
            <span aria-hidden="true">*</span>
            <span className="mp-visuellement-cache">(obligatoire)</span>
          </span>
        </legend>
        <ChoixRepondants
          liste={etat.repondants}
          saisie={s}
          erreurs={f.erreurs}
          clientNom={clientNom}
          hrefPortail={hrefPortail}
          actualisation={actualisation}
          onActualiser={() => void actualiserRepondants()}
          onChoisir={choisir}
          onToutCocher={toutCocher}
        />
        {f.erreurs.repondants ? (
          <p className="mp-champ__erreur" id={idErreurRepondants}>
            <Icone nom="attention" taille={16} />
            <span>{f.erreurs.repondants}</span>
          </p>
        ) : null}
      </fieldset>

      <div className="mp-grille-champs">
        <Champ
          libelle="Date limite indicative"
          name="date_limite"
          type="date"
          min={aujourdhui}
          value={s.date_limite}
          erreur={f.erreurs.date_limite}
          aide="Facultative, à titre d'indication : rappelée dans les e-mails d'invitation et de relance. Elle n'empêche pas de répondre : seule votre clôture du questionnaire le ferme."
          onChange={(e) => setS((x) => ({ ...x, date_limite: e.target.value }))}
        />
        <CaseACocher
          libelle="Relances automatiques par e-mail"
          aide="À J+3 puis J+7 après l'envoi, aux seuls répondants qui n'ont pas soumis ; désactivables à tout moment."
          checked={s.relances_auto}
          onChange={(e) => setS((x) => ({ ...x, relances_auto: e.target.checked }))}
        />
      </div>

      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="plus"
          chargement={f.enCours}
          texteChargement="Création…"
          disabled={comptes.length === 0 || actualisation}
        >
          Créer l'envoi en brouillon
        </Bouton>
        <Bouton variante="secondaire" onClick={onAnnuler} disabled={f.enCours}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}

interface ChoixRepondantsProps {
  liste: ListeRepondants;
  saisie: SaisieEnvoi;
  erreurs: Partial<Record<ChampEnvoi, string>>;
  clientNom: string;
  hrefPortail: string | null;
  actualisation: boolean;
  onActualiser: () => void;
  onChoisir: (id: string, patch: PatchRepondant) => void;
  onToutCocher: (choisi: boolean) => void;
}

/** Contenu du groupe « Répondants » : erreur de chargement, aucun éligible, ou liste à cocher. */
function ChoixRepondants({
  liste,
  saisie,
  erreurs,
  clientNom,
  hrefPortail,
  actualisation,
  onActualiser,
  onChoisir,
  onToutCocher,
}: ChoixRepondantsProps) {
  const actualiser = (
    <Bouton
      variante="discret"
      onClick={onActualiser}
      chargement={actualisation}
      texteChargement="Actualisation…"
    >
      Actualiser la liste
    </Bouton>
  );
  if (!liste.ok) {
    return (
      <Alerte tonalite="attention" titre="Les répondants n'ont pas pu être chargés.">
        <p>{liste.message}</p>
        <div className="mp-barre-actions mp-barre-actions--compacte">{actualiser}</div>
      </Alerte>
    );
  }
  if (liste.elements.length === 0) {
    return (
      <Alerte tonalite="attention" titre={TITRE_AUCUN_REPONDANT}>
        <p>{aideAucunRepondant(hrefPortail !== null)}</p>
        <div className="mp-barre-actions mp-barre-actions--compacte">
          {hrefPortail ? (
            <Link href={hrefPortail}>{`Ouvrir le portail client de ${clientNom}`}</Link>
          ) : null}
          {actualiser}
        </div>
      </Alerte>
    );
  }
  return (
    <>
      <p className="mp-champ__aide">
        Dirigeants et contributeurs actifs du portail du client.{" "}
        {saisie.mode === "par_fonction"
          ? "En mode « par fonction », la fonction de chaque répondant est obligatoire."
          : "La fonction est facultative dans ce mode."}
        {liste.tronquee
          ? " Liste partielle : seuls les premiers répondants, par ordre alphabétique, sont proposés."
          : null}
      </p>
      <div className="mp-barre-actions mp-barre-actions--compacte">
        <Bouton variante="discret" onClick={() => onToutCocher(true)}>
          Tout cocher
        </Bouton>
        <Bouton variante="discret" onClick={() => onToutCocher(false)}>
          Tout décocher
        </Bouton>
        {actualiser}
      </div>
      <ul className="mp-qe-elements">
        {liste.elements.map((c) => {
          const r = saisie.repondants[c.id] ?? { choisi: false, fonction: "" };
          return (
            <li key={c.id} className="mp-choix-repondant">
              <CaseACocher
                name="repondants"
                value={c.id}
                libelle={c.nom}
                aide={`${rolesRepondant(c)} · ${c.email}`}
                checked={r.choisi}
                onChange={(e) => onChoisir(c.id, { choisi: e.target.checked })}
              />
              {r.choisi ? (
                <Champ
                  libelle={`Fonction de ${c.nom}`}
                  name={`fonction-${c.id}`}
                  required={saisie.mode === "par_fonction"}
                  maxLength={FONCTION_MAX}
                  autoComplete="off"
                  value={r.fonction}
                  erreur={erreurs[`fonction.${c.id}`]}
                  aide={
                    saisie.mode === "par_fonction" ? "Ex. Directeur général, DAF." : "Facultative."
                  }
                  onChange={(e) => onChoisir(c.id, { fonction: e.target.value })}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
