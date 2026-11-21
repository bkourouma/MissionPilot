"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useT, useLangue } from "../../../../../components/i18n/FournisseurLangue";
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
  AIDE_MODE_EN,
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
  optionsModes,
  PAGES_MAX_REPONDANTS,
  rolesRepondant,
  SAISIE_ENVOI_VIDE,
  TAILLE_PAGE_CHOIX,
  TITRE_AUCUN_REPONDANT,
  TITRE_AUCUN_REPONDANT_EN,
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
  const t = useT();
  const [ouvert, setOuvert] = useState(false);
  if (!ouvert) {
    return (
      <div>
        <Bouton icone="envoyer" onClick={() => setOuvert(true)}>
          {t("Préparer un envoi", "Prepare a sending")}
        </Bouton>
      </div>
    );
  }
  return (
    <section className="mp-sous-formulaire mp-pile" aria-labelledby="titre-preparation">
      <h2 id="titre-preparation" className="mp-sous-formulaire__titre">
        {t("Préparer l'envoi d'un questionnaire", "Prepare the sending of a questionnaire")}
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
  const t = useT();
  const langue = useLangue();
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
      return { ok: false, message: messageRepondantsEligibles(e, langue) };
    }
  }, [missionId, langue]);

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
      <Squelette
        lignes={5}
        libelle={t(
          "Chargement des questionnaires validés et des répondants…",
          "Loading approved questionnaires and respondents…",
        )}
      />
    );
  }
  if (etat.phase === "erreur") {
    return (
      <div className="mp-pile">
        <Alerte
          tonalite="danger"
          titre={t("Préparation impossible", "Could not prepare the sending")}
        >
          <p>{etat.message}</p>
        </Alerte>
        <div className="mp-barre-actions">
          <Bouton variante="secondaire" onClick={() => void charger()}>
            {t("Réessayer", "Try again")}
          </Bouton>
          <Bouton variante="discret" onClick={onAnnuler}>
            {t("Annuler", "Cancel")}
          </Bouton>
        </div>
      </div>
    );
  }
  if (etat.versions.length === 0) {
    return (
      <EtatVide
        titre={t("Aucun questionnaire validé à envoyer.", "No approved questionnaire to send.")}
        icone="bulle"
        action={
          <div className="mp-barre-actions">
            <Link href="/questionnaires">
              {t("Préparer et valider un modèle", "Prepare and approve a template")}
            </Link>
            <Bouton variante="discret" onClick={onAnnuler}>
              {t("Fermer", "Close")}
            </Bouton>
          </div>
        }
      >
        <p>
          {t(
            "Seule une version validée (figée) d'un modèle du cabinet s'envoie aux répondants.",
            "Only an approved (locked) version of a firm template can be sent to respondents.",
          )}
        </p>
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
      validerEnvoi(s, aujourdhui, langue),
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
        messageSpecifique: (e) => messageCreationEnvoi(e, langue),
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
        titreErreur={t("Préparation impossible", "Could not prepare the sending")}
      />
      <p className="mp-indice mp-texte-doux mp-texte-petit">
        <Icone nom="info" taille={16} />
        <span>
          {t(
            "L'envoi est d'abord créé en brouillon : rien n'est transmis aux répondants avant que vous ne l'envoyiez depuis sa page.",
            "The sending is first created as a draft: nothing is sent to respondents until you send it from its page.",
          )}
        </span>
      </p>
      <Select
        libelle={t(
          "Questionnaire (dernière version validée)",
          "Questionnaire (latest approved version)",
        )}
        name="version_id"
        required
        invite={t("Choisir un questionnaire…", "Choose a questionnaire…")}
        options={etat.versions}
        value={s.version_id}
        erreur={f.erreurs.version_id}
        aide={
          etat.tronquee
            ? t(
                "Liste partielle : seuls les premiers modèles sont proposés.",
                "Partial list: only the first templates are offered.",
              )
            : undefined
        }
        onChange={(e) => setS((x) => ({ ...x, version_id: e.target.value }))}
      />

      <fieldset className="mp-groupe" aria-invalid={f.erreurs.mode ? true : undefined}>
        <legend className="mp-champ__libelle">
          {t("Mode de réponse", "Response mode")}
          <span className="mp-champ__requis">
            {" "}
            <span aria-hidden="true">*</span>
            <span className="mp-visuellement-cache">({t("obligatoire", "required")})</span>
          </span>
        </legend>
        <div className="mp-groupe__options">
          {optionsModes(langue).map((o) => (
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
                  {(langue === "en" ? AIDE_MODE_EN : AIDE_MODE)[o.valeur]}
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
          {t(
            `Répondants de ${clientNom} (${choisis} choisi${choisis > 1 ? "s" : ""})`,
            `Respondents of ${clientNom} (${choisis} selected)`,
          )}
          <span className="mp-champ__requis">
            {" "}
            <span aria-hidden="true">*</span>
            <span className="mp-visuellement-cache">({t("obligatoire", "required")})</span>
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
          libelle={t("Date limite", "Due date")}
          name="date_limite"
          type="date"
          min={aujourdhui}
          value={s.date_limite}
          erreur={f.erreurs.date_limite}
          aide={t(
            "Facultative : rappelée dans les e-mails d'invitation et de relance. Passé ce jour (inclus), le portail refuse toute réponse jusqu'à ce que vous la prolongiez.",
            "Optional: mentioned in invitation and reminder emails. After this day (inclusive), the portal rejects any response until you extend it.",
          )}
          onChange={(e) => setS((x) => ({ ...x, date_limite: e.target.value }))}
        />
        <CaseACocher
          libelle={t("Relances automatiques par e-mail", "Automatic email reminders")}
          aide={t(
            "À J+3 puis J+7 après l'envoi, aux seuls répondants qui n'ont pas soumis ; désactivables à tout moment.",
            "At D+3 then D+7 after sending, only to respondents who have not submitted; can be turned off at any time.",
          )}
          checked={s.relances_auto}
          onChange={(e) => setS((x) => ({ ...x, relances_auto: e.target.checked }))}
        />
      </div>

      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="plus"
          chargement={f.enCours}
          texteChargement={t("Création…", "Creating…")}
          disabled={comptes.length === 0 || actualisation}
        >
          {t("Créer l'envoi en brouillon", "Create the sending as a draft")}
        </Bouton>
        <Bouton variante="secondaire" onClick={onAnnuler} disabled={f.enCours}>
          {t("Annuler", "Cancel")}
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
  const t = useT();
  const langue = useLangue();
  const actualiser = (
    <Bouton
      variante="discret"
      onClick={onActualiser}
      chargement={actualisation}
      texteChargement={t("Actualisation…", "Refreshing…")}
    >
      {t("Actualiser la liste", "Refresh the list")}
    </Bouton>
  );
  if (!liste.ok) {
    return (
      <Alerte
        tonalite="attention"
        titre={t(
          "Les répondants n'ont pas pu être chargés.",
          "The respondents could not be loaded.",
        )}
      >
        <p>{liste.message}</p>
        <div className="mp-barre-actions mp-barre-actions--compacte">{actualiser}</div>
      </Alerte>
    );
  }
  if (liste.elements.length === 0) {
    return (
      <Alerte
        tonalite="attention"
        titre={langue === "en" ? TITRE_AUCUN_REPONDANT_EN : TITRE_AUCUN_REPONDANT}
      >
        <p>{aideAucunRepondant(hrefPortail !== null, langue)}</p>
        <div className="mp-barre-actions mp-barre-actions--compacte">
          {hrefPortail ? (
            <Link href={hrefPortail}>
              {t(
                `Ouvrir le portail client de ${clientNom}`,
                `Open the client portal of ${clientNom}`,
              )}
            </Link>
          ) : null}
          {actualiser}
        </div>
      </Alerte>
    );
  }
  return (
    <>
      <p className="mp-champ__aide">
        {t(
          "Dirigeants et contributeurs actifs du portail du client.",
          "Active executives and contributors of the client portal.",
        )}{" "}
        {saisie.mode === "par_fonction"
          ? t(
              "En mode « par fonction », la fonction de chaque répondant est obligatoire.",
              'In "by role" mode, each respondent\'s role is required.',
            )
          : t("La fonction est facultative dans ce mode.", "The role is optional in this mode.")}
        {liste.tronquee
          ? t(
              " Liste partielle : seuls les premiers répondants, par ordre alphabétique, sont proposés.",
              " Partial list: only the first respondents, in alphabetical order, are offered.",
            )
          : null}
      </p>
      <div className="mp-barre-actions mp-barre-actions--compacte">
        <Bouton variante="discret" onClick={() => onToutCocher(true)}>
          {t("Tout cocher", "Select all")}
        </Bouton>
        <Bouton variante="discret" onClick={() => onToutCocher(false)}>
          {t("Tout décocher", "Deselect all")}
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
                aide={`${rolesRepondant(c, langue)} · ${c.email}`}
                checked={r.choisi}
                onChange={(e) => onChoisir(c.id, { choisi: e.target.checked })}
              />
              {r.choisi ? (
                <Champ
                  libelle={t(`Fonction de ${c.nom}`, `Role of ${c.nom}`)}
                  name={`fonction-${c.id}`}
                  required={saisie.mode === "par_fonction"}
                  maxLength={FONCTION_MAX}
                  autoComplete="off"
                  value={r.fonction}
                  erreur={erreurs[`fonction.${c.id}`]}
                  aide={
                    saisie.mode === "par_fonction"
                      ? t("Ex. Directeur général, DAF.", "E.g. CEO, CFO.")
                      : t("Facultative.", "Optional.")
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
